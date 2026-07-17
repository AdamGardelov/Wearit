export function MannequinCanvas({ items }) {
  return (
    <div className="mannequin-stage" aria-label="Outfit preview">
      <img
        className="mannequin-base"
        src="/mannequin.svg"
        alt=""
        role="presentation"
      />
      {items.map((item) => item.cutoutUrl && (
        <img
          key={item.id}
          className="mannequin-garment"
          src={item.cutoutUrl}
          alt={item.name || "Selected garment"}
          style={{
            left: `${item.anchor_x * 100}%`,
            top: `${item.anchor_y * 100}%`,
            width: `${item.scale * 100}%`,
            zIndex: item.layer_order,
            transform: `translate(-50%, -50%) rotate(${item.rotation_degrees}deg)`,
          }}
        />
      ))}
    </div>
  );
}
