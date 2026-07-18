import { useEffect, useRef, useState } from "react";
import { AlignmentEditor } from "./AlignmentEditor.jsx";
import { parseImportBundle } from "./importBundle.js";
import "./admin.css";

function statusLabel(status) {
  if (status === "imported") return "Importerad";
  if (status === "already-imported") return "Redan importerad";
  if (status === "uploading") return "Laddar upp…";
  if (status === "skipped") return "Överhoppad";
  return "Redo för granskning";
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
      setBundleError(error.message || "Paketet kunde inte öppnas.");
    }
  };

  const updatePlacement = (placement) => {
    setDrafts((existing) => existing.map((draft) => (
      draft.manifestItem.id === currentId ? { ...draft, placement } : draft
    )));
  };

  // Move the review focus to the next item in bundle order. The draft order never changes,
  // so resolving by id keeps this correct even when called after an async status update.
  const advanceToNext = (fromId) => {
    const index = drafts.findIndex((draft) => draft.manifestItem.id === fromId);
    const next = index >= 0 ? drafts[index + 1] : null;
    if (next) {
      setCurrentId(next.manifestItem.id);
      setImportError("");
    }
  };

  const skipCurrent = () => {
    if (!current || current.importStatus === "uploading") return;
    const itemId = current.manifestItem.id;
    setDrafts((existing) => existing.map((draft) => (
      draft.manifestItem.id === itemId
        && draft.importStatus !== "imported"
        && draft.importStatus !== "already-imported"
        ? { ...draft, importStatus: "skipped" }
        : draft
    )));
    setImportError("");
    advanceToNext(itemId);
  };

  const approveCurrent = async () => {
    if (!current || current.importStatus === "uploading") return;
    const itemId = current.manifestItem.id;
    const request = {
      manifestItem: current.manifestItem,
      cutoutFile: current.cutoutFile,
      detailFiles: current.detailFiles,
      imageFiles: current.imageFiles,
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
      // Roll straight on to the next item so a bundle can be worked through without extra clicks.
      advanceToNext(itemId);
    } catch (error) {
      setDrafts((existing) => existing.map((draft) => (
        draft.manifestItem.id === itemId ? { ...draft, importStatus: "failed" } : draft
      )));
      setImportError(error.message || "Uppladdningen avbröts. Försök igen.");
    }
  };

  const checkStorage = async () => {
    setCheckingStorage(true);
    setReconciliationError("");
    setConfirmCleanup(false);
    try {
      setReconciliation(await repository.reconcileWardrobeAssets());
    } catch (error) {
      setReconciliationError(error.message || "Lagringen kunde inte kontrolleras.");
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
      setReconciliationError(error.message || "Föräldralösa filer kunde inte raderas.");
    }
  };

  return (
    <main className="import-admin">
      <header className="import-admin-header">
        <div>
          <p>Privat admin</p>
          <h1>Importera granskade plagg</h1>
          <p>Välj ett Codex-förberett paket, justera varje urklipp och godkänn det.</p>
        </div>
        {onClose && <button type="button" className="text-action" onClick={onClose}>Stäng</button>}
      </header>

      <section className="import-bundle-picker" aria-labelledby="bundle-heading">
        <h2 id="bundle-heading">Granska paket</h2>
        <label className="bundle-file-label">
          <span>Välj importpaket</span>
          <input
            type="file"
            multiple
            webkitdirectory=""
            directory=""
            onChange={chooseBundle}
          />
        </label>
        <p>Endast godkända urklipp och refererade detaljbilder accepteras. Råa foton stannar lokalt.</p>
        {bundleError && <p role="alert" className="admin-error">{bundleError}</p>}
      </section>

      {drafts.length > 0 && (
        <div className="import-review-layout">
          <nav className="review-card-list" aria-label="Paketets plagg">
            {drafts.map((draft, index) => (
              <button
                type="button"
                key={draft.manifestItem.id}
                aria-current={draft.manifestItem.id === currentId ? "true" : undefined}
                onClick={() => {
                  setCurrentId(draft.manifestItem.id);
                  setImportError("");
                }}
                aria-label={`Granska ${draft.manifestItem.name}`}
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
              <div className="import-review-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={current.importStatus === "uploading"
                    || current.importStatus === "imported"
                    || current.importStatus === "already-imported"}
                  onClick={approveCurrent}
                >
                  {current.importStatus === "failed" ? "Försök igen" : "Godkänn och ladda upp"}
                </button>
                {current.importStatus !== "imported" && current.importStatus !== "already-imported" && (
                  <button
                    type="button"
                    className="text-action"
                    disabled={current.importStatus === "uploading"}
                    onClick={skipCurrent}
                  >
                    Hoppa över
                  </button>
                )}
              </div>
            </article>
          )}
        </div>
      )}

      <section className="reconciliation-panel" aria-labelledby="storage-heading">
        <div>
          <h2 id="storage-heading">Lagringskontroll</h2>
          <p>Jämför privat uppladdade filer med garderobsposter.</p>
        </div>
        <button type="button" className="text-action" disabled={checkingStorage} onClick={checkStorage}>
          {checkingStorage ? "Kontrollerar…" : "Kontrollera lagring"}
        </button>
        {reconciliationError && <p role="alert" className="admin-error">{reconciliationError}</p>}
        {reconciliation && (
          <div className="reconciliation-results">
            <div>
              <h3>Föräldralösa lagringssökvägar</h3>
              {reconciliation.orphanedStoragePaths.length ? (
                <ul>{reconciliation.orphanedStoragePaths.map((path) => <li key={path}>{path}</li>)}</ul>
              ) : <p>Inga</p>}
            </div>
            <div>
              <h3>Plagg som saknar filer</h3>
              {reconciliation.missingStorageItemIds.length ? (
                <ul>{reconciliation.missingStorageItemIds.map((id) => <li key={id}>{id}</li>)}</ul>
              ) : <p>Inga</p>}
            </div>
            {reconciliation.orphanedStoragePaths.length > 0 && !confirmCleanup && (
              <button type="button" className="danger-action" onClick={() => setConfirmCleanup(true)}>
                Rensa föräldralösa filer
              </button>
            )}
            {confirmCleanup && (
              <div className="cleanup-confirmation" role="group" aria-label="Bekräfta rensning">
                <p>Detta raderar permanent endast de exakta sökvägar som listas ovan.</p>
                <button type="button" className="danger-action" onClick={deleteConfirmedOrphans}>
                  Bekräfta radering av {reconciliation.orphanedStoragePaths.length} {reconciliation.orphanedStoragePaths.length === 1 ? "fil" : "filer"}
                </button>
                <button type="button" className="text-action" onClick={() => setConfirmCleanup(false)}>Avbryt</button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
