import { useEffect, useRef, useState } from "react";
import { AlignmentEditor } from "./AlignmentEditor.jsx";
import { parseImportBundle } from "./importBundle.js";
import "./admin.css";

function statusLabel(status) {
  if (status === "imported") return "Imported";
  if (status === "already-imported") return "Already imported";
  if (status === "uploading") return "Uploading…";
  return "Ready for review";
}

export function ImportAdminView({ repository, onClose, onImported }) {
  const [drafts, setDrafts] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [bundleError, setBundleError] = useState("");
  const [importError, setImportError] = useState("");
  const [reconciliation, setReconciliation] = useState(null);
  const [reconciliationError, setReconciliationError] = useState("");
  const [checkingStorage, setCheckingStorage] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const bundleRef = useRef(null);
  const selectionSequence = useRef(0);

  useEffect(() => () => {
    selectionSequence.current += 1;
    bundleRef.current?.cleanup();
    bundleRef.current = null;
  }, []);

  const current = drafts.find((draft) => draft.manifestItem.id === currentId) ?? null;

  const chooseBundle = async (event) => {
    const files = Array.from(event.target.files || []);
    const sequence = selectionSequence.current + 1;
    selectionSequence.current = sequence;
    setBundleError("");
    setImportError("");
    try {
      const parsed = await parseImportBundle(files);
      if (sequence !== selectionSequence.current) {
        parsed.cleanup();
        return;
      }
      bundleRef.current?.cleanup();
      bundleRef.current = parsed;
      const nextDrafts = parsed.items.map((draft) => ({ ...draft, importStatus: "pending" }));
      setDrafts(nextDrafts);
      setCurrentId(nextDrafts[0]?.manifestItem.id ?? null);
    } catch (error) {
      if (sequence !== selectionSequence.current) return;
      bundleRef.current?.cleanup();
      bundleRef.current = null;
      setDrafts([]);
      setCurrentId(null);
      setBundleError(error.message || "The bundle could not be opened.");
    }
  };

  const updatePlacement = (placement) => {
    setDrafts((existing) => existing.map((draft) => (
      draft.manifestItem.id === currentId ? { ...draft, placement } : draft
    )));
  };

  const approveCurrent = async () => {
    if (!current || current.importStatus === "uploading") return;
    const itemId = current.manifestItem.id;
    const request = {
      manifestItem: current.manifestItem,
      cutoutFile: current.cutoutFile,
      detailFiles: current.detailFiles,
      placement: current.placement,
    };
    setImportError("");
    setDrafts((existing) => existing.map((draft) => (
      draft.manifestItem.id === itemId ? { ...draft, importStatus: "uploading" } : draft
    )));
    try {
      const result = await repository.importWardrobeItem(request);
      setDrafts((existing) => existing.map((draft) => (
        draft.manifestItem.id === itemId
          ? { ...draft, importStatus: result.alreadyImported ? "already-imported" : "imported" }
          : draft
      )));
      await onImported?.(result);
    } catch (error) {
      setDrafts((existing) => existing.map((draft) => (
        draft.manifestItem.id === itemId ? { ...draft, importStatus: "failed" } : draft
      )));
      setImportError(error.message || "The upload was interrupted. Try again.");
    }
  };

  const checkStorage = async () => {
    setCheckingStorage(true);
    setReconciliationError("");
    setConfirmCleanup(false);
    try {
      setReconciliation(await repository.reconcileWardrobeAssets());
    } catch (error) {
      setReconciliationError(error.message || "Storage could not be checked.");
    } finally {
      setCheckingStorage(false);
    }
  };

  const deleteConfirmedOrphans = async () => {
    const paths = [...(reconciliation?.orphanedStoragePaths || [])];
    setReconciliationError("");
    try {
      await repository.removeOrphanedWardrobeAssets(paths);
      setConfirmCleanup(false);
      await checkStorage();
    } catch (error) {
      setReconciliationError(error.message || "Orphaned assets could not be deleted.");
    }
  };

  return (
    <main className="import-admin">
      <header className="import-admin-header">
        <div>
          <p>Private admin</p>
          <h1>Import reviewed clothes</h1>
          <p>Choose a Codex-prepared bundle, align each cutout, then approve it.</p>
        </div>
        {onClose && <button type="button" className="text-action" onClick={onClose}>Close</button>}
      </header>

      <section className="import-bundle-picker" aria-labelledby="bundle-heading">
        <h2 id="bundle-heading">Review bundle</h2>
        <label className="bundle-file-label">
          <span>Choose import bundle</span>
          <input
            type="file"
            multiple
            webkitdirectory=""
            directory=""
            onChange={chooseBundle}
          />
        </label>
        <p>Only approved cutouts and referenced detail derivatives are accepted. Raw photos stay local.</p>
        {bundleError && <p role="alert" className="admin-error">{bundleError}</p>}
      </section>

      {drafts.length > 0 && (
        <div className="import-review-layout">
          <nav className="review-card-list" aria-label="Bundle items">
            {drafts.map((draft, index) => (
              <button
                type="button"
                key={draft.manifestItem.id}
                aria-current={draft.manifestItem.id === currentId ? "true" : undefined}
                onClick={() => {
                  setCurrentId(draft.manifestItem.id);
                  setImportError("");
                }}
                aria-label={`Review ${draft.manifestItem.name}`}
              >
                <span>{index + 1}. {draft.manifestItem.name}</span>
                <small>{statusLabel(draft.importStatus)}</small>
              </button>
            ))}
          </nav>

          {current && (
            <article className="import-review-card">
              <div className="review-card-heading">
                <div>
                  <p>{current.manifestItem.category}</p>
                  <h2>{current.manifestItem.name}</h2>
                </div>
                <strong className={`import-state ${current.importStatus}`}>
                  {statusLabel(current.importStatus)}
                </strong>
              </div>
              <AlignmentEditor draft={current} onChange={updatePlacement} />
              {importError && <p role="alert" className="admin-error">{importError}</p>}
              <button
                type="button"
                className="primary-action"
                disabled={current.importStatus === "uploading"
                  || current.importStatus === "imported"
                  || current.importStatus === "already-imported"}
                onClick={approveCurrent}
              >
                {current.importStatus === "failed" ? "Retry upload" : "Approve and upload"}
              </button>
            </article>
          )}
        </div>
      )}

      <section className="reconciliation-panel" aria-labelledby="storage-heading">
        <div>
          <h2 id="storage-heading">Storage check</h2>
          <p>Compare private uploaded assets with wardrobe records.</p>
        </div>
        <button type="button" className="text-action" disabled={checkingStorage} onClick={checkStorage}>
          {checkingStorage ? "Checking…" : "Check storage"}
        </button>
        {reconciliationError && <p role="alert" className="admin-error">{reconciliationError}</p>}
        {reconciliation && (
          <div className="reconciliation-results">
            <div>
              <h3>Orphaned storage paths</h3>
              {reconciliation.orphanedStoragePaths.length ? (
                <ul>{reconciliation.orphanedStoragePaths.map((path) => <li key={path}>{path}</li>)}</ul>
              ) : <p>None</p>}
            </div>
            <div>
              <h3>Items missing assets</h3>
              {reconciliation.missingStorageItemIds.length ? (
                <ul>{reconciliation.missingStorageItemIds.map((id) => <li key={id}>{id}</li>)}</ul>
              ) : <p>None</p>}
            </div>
            {reconciliation.orphanedStoragePaths.length > 0 && !confirmCleanup && (
              <button type="button" className="danger-action" onClick={() => setConfirmCleanup(true)}>
                Clean up orphaned assets
              </button>
            )}
            {confirmCleanup && (
              <div className="cleanup-confirmation" role="group" aria-label="Confirm orphan cleanup">
                <p>This permanently deletes only the exact paths listed above.</p>
                <button type="button" className="danger-action" onClick={deleteConfirmedOrphans}>
                  Confirm delete {reconciliation.orphanedStoragePaths.length} {reconciliation.orphanedStoragePaths.length === 1 ? "asset" : "assets"}
                </button>
                <button type="button" className="text-action" onClick={() => setConfirmCleanup(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
