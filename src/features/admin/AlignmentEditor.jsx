import { MannequinCanvas } from "../dress/MannequinCanvas.jsx";

const CONTROLS = [
  { key: "anchorX", label: "Ankare X", min: 0, max: 1, step: 0.01 },
  { key: "anchorY", label: "Ankare Y", min: 0, max: 1, step: 0.01 },
  { key: "scale", label: "Skala", min: 0.05, max: 2, step: 0.01 },
  { key: "rotationDegrees", label: "Rotation", min: -180, max: 180, step: 1 },
  { key: "layerOrder", label: "Lagerordning", min: 0, max: 100, step: 1 },
];

export function AlignmentEditor({ draft, onChange }) {
  const previewItem = {
    id: draft.manifestItem.id,
    name: draft.manifestItem.name,
    cutoutUrl: draft.cutoutUrl,
    anchor_x: draft.placement.anchorX,
    anchor_y: draft.placement.anchorY,
    scale: draft.placement.scale,
    rotation_degrees: draft.placement.rotationDegrees,
    layer_order: draft.placement.layerOrder,
  };

  return (
    <div className="alignment-editor">
      <div className="alignment-preview">
        <MannequinCanvas items={[previewItem]} />
      </div>
      <fieldset className="alignment-controls">
        <legend>Placering</legend>
        {CONTROLS.map((control) => (
          <label key={control.key}>
            <span>{control.label}</span>
            <input
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={draft.placement[control.key]}
              onChange={(event) => onChange({
                ...draft.placement,
                [control.key]: Number(event.target.value),
              })}
            />
            <output>{draft.placement[control.key]}</output>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
