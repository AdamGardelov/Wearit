import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsOut,
  Minus,
  Plus,
  X,
} from "@phosphor-icons/react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const SWIPE_DISTANCE = 55;
const CLOSE_DISTANCE = 90;
const DOUBLE_TAP_MS = 300;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function viewLabel(view) {
  if (view === "front") return "Front";
  if (view === "back") return "Back";
  if (view === "detail") return "Detail";
  return "";
}

// Full-screen, ecommerce-style zoom viewer. Pointer events unify mouse, touch, and
// pen: single-pointer drag pans when zoomed or swipes when not, two pointers pinch.
// Manual phone testing is authoritative for gesture feel.
export function ImageLightbox({ images, index, name, onIndexChange, onClose }) {
  const overlayRef = useRef(null);
  const stageRef = useRef(null);
  const closeButtonRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const pinchRef = useRef(null);
  const lastTapRef = useRef(0);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const image = images[index] ?? null;
  const count = images.length;
  const zoomed = transform.scale > 1.01;
  const label = image?.view ? `${name}, ${viewLabel(image.view)}` : name;

  // Zoom and pan reset whenever the visible image changes.
  useEffect(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
    setFailed(false);
    pointersRef.current.clear();
    gestureRef.current = null;
    pinchRef.current = null;
  }, [index]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const clampOffset = useCallback((next) => {
    const stage = stageRef.current;
    if (!stage) return next;
    const maxX = ((next.scale - 1) * stage.clientWidth) / 2;
    const maxY = ((next.scale - 1) * stage.clientHeight) / 2;
    return {
      scale: next.scale,
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    };
  }, []);

  const goTo = useCallback((nextIndex) => {
    if (count < 2) return;
    onIndexChange((nextIndex + count) % count);
  }, [count, onIndexChange]);

  const setScale = useCallback((scale) => {
    setTransform((current) => clampOffset({
      scale: clamp(scale, MIN_SCALE, MAX_SCALE),
      x: current.x,
      y: current.y,
    }));
  }, [clampOffset]);

  const resetZoom = useCallback(() => setTransform({ scale: 1, x: 0, y: 0 }), []);

  const toggleZoom = useCallback(() => {
    setTransform((current) => (current.scale > 1.01
      ? { scale: 1, x: 0, y: 0 }
      : { scale: DOUBLE_TAP_SCALE, x: 0, y: 0 }));
  }, []);

  const retry = useCallback(() => {
    setFailed(false);
    setRetryToken((token) => token + 1);
  }, []);

  // Keep the latest scale reachable inside the wheel listener without re-binding it.
  const transformScaleRef = useRef(transform.scale);
  transformScaleRef.current = transform.scale;

  // Wheel zoom needs a non-passive listener to prevent the page from scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.3 : -0.3;
      setScale(transformScaleRef.current + delta);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [setScale]);

  const handleKeyDown = (event) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      case "ArrowRight":
        event.preventDefault();
        goTo(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        goTo(index - 1);
        break;
      case "+":
      case "=":
        event.preventDefault();
        setScale(transform.scale + 0.5);
        break;
      case "-":
      case "_":
        event.preventDefault();
        setScale(transform.scale - 0.5);
        break;
      case "0":
        event.preventDefault();
        resetZoom();
        break;
      case "Tab": {
        const focusable = overlayRef.current
          ? [...overlayRef.current.querySelectorAll(FOCUSABLE_SELECTOR)]
          : [];
        if (!focusable.length) {
          event.preventDefault();
          break;
        }
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        break;
      }
      default:
        break;
    }
  };

  const pointerDown = (event) => {
    stageRef.current?.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      pinchRef.current = {
        startDistance: Math.hypot(first.x - second.x, first.y - second.y) || 1,
        startScale: transform.scale,
      };
      gestureRef.current = null;
    } else if (pointersRef.current.size === 1) {
      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTx: transform.x,
        startTy: transform.y,
        startScale: transform.scale,
        pointerType: event.pointerType,
        moved: false,
      };
    }
  };

  const pointerMove = (event) => {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y) || 1;
      const scale = clamp(
        pinchRef.current.startScale * (distance / pinchRef.current.startDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      setTransform((current) => clampOffset({ scale, x: current.x, y: current.y }));
      return;
    }

    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) gesture.moved = true;
    if (gesture.startScale > 1.01) {
      setTransform(clampOffset({
        scale: gesture.startScale,
        x: gesture.startTx + dx,
        y: gesture.startTy + dy,
      }));
    }
  };

  const pointerUp = (event) => {
    pointersRef.current.delete(event.pointerId);
    stageRef.current?.releasePointerCapture?.(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;

    // A finger lifted from a pinch: re-anchor panning to the remaining pointer.
    if (pointersRef.current.size === 1) {
      const [[pointerId, pointer]] = [...pointersRef.current.entries()];
      gestureRef.current = {
        pointerId,
        startX: pointer.x,
        startY: pointer.y,
        startTx: transform.x,
        startTy: transform.y,
        startScale: transform.scale,
        pointerType: event.pointerType,
        moved: true,
      };
      return;
    }

    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId || pointersRef.current.size) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.startScale > 1.01) return; // finished a pan

    if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      goTo(index + (dx < 0 ? 1 : -1));
      return;
    }
    if (dy > CLOSE_DISTANCE && dy > Math.abs(dx)) {
      onClose();
      return;
    }
    if (gesture.moved) return;

    if (gesture.pointerType === "mouse") {
      toggleZoom();
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      toggleZoom();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  return (
    <div
      ref={overlayRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} image viewer`}
      onKeyDown={handleKeyDown}
    >
      <div className="lightbox-toolbar">
        <span className="lightbox-counter" aria-live="polite">
          {count > 1 ? `${index + 1} / ${count}` : viewLabel(image?.view) || name}
        </span>
        <div className="lightbox-tools">
          <button
            type="button"
            onClick={() => setScale(transform.scale - 0.5)}
            aria-label="Zoom out"
            disabled={transform.scale <= MIN_SCALE}
          >
            <Minus size={20} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setScale(transform.scale + 0.5)}
            aria-label="Zoom in"
            disabled={transform.scale >= MAX_SCALE}
          >
            <Plus size={20} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            aria-label="Reset zoom"
            disabled={!zoomed}
          >
            <ArrowsOut size={20} weight="bold" aria-hidden="true" />
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            className="lightbox-close"
            onClick={onClose}
            aria-label="Close image viewer"
          >
            <X size={22} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="lightbox-stage"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        {failed ? (
          <div className="lightbox-error" role="alert">
            <p>This image could not be loaded.</p>
            <button type="button" onClick={retry}>Retry</button>
          </div>
        ) : image ? (
          <img
            key={`${image.id}-${retryToken}`}
            className="lightbox-image"
            src={image.url}
            alt={label}
            draggable="false"
            onError={() => setFailed(true)}
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              cursor: zoomed ? "grab" : "zoom-in",
            }}
          />
        ) : null}
      </div>

      {count > 1 && (
        <div className="lightbox-nav" aria-hidden={zoomed ? "true" : undefined}>
          <button type="button" onClick={() => goTo(index - 1)} aria-label="Previous image">
            <ArrowLeft size={24} weight="bold" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => goTo(index + 1)} aria-label="Next image">
            <ArrowRight size={24} weight="bold" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
