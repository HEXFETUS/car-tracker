import { useRef, useState, useEffect, useCallback } from 'react';
import { X, Pencil } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (dataUrl: string | null) => void;
  /** Current signature value to restore when editing */
  currentValue?: string | null;
  /** Optional custom title */
  title?: string;
}

export function SignatureModal({
  isOpen,
  onClose,
  onConfirm,
  currentValue,
  title = 'Sign Here',
}: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset canvas when modal opens
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);

    if (currentValue) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHasDrawn(true);
      };
      img.src = currentValue;
    }
  }, [isOpen, currentValue]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * (canvas.width / rect.width),
        y: (touch.clientY - rect.top) * (canvas.height / rect.height),
      };
    }
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  function startDrawing(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
    setHasDrawn(true);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function stopDrawing() {
    setIsDrawing(false);
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  function handleConfirm() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hasDrawn) {
      onConfirm(null);
    } else {
      onConfirm(canvas.toDataURL('image/png'));
    }
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity sm:p-4"
      onClick={(e) => {
        if (e.target === modalRef.current) onClose();
      }}
    >
      <div className="relative flex max-h-dvh w-full max-w-md flex-col overflow-hidden bg-white shadow-brand-xl animate-in fade-in zoom-in-95 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Pencil className="size-4 text-brand-teal" />
            <h2 className="text-base font-bold text-zinc-900">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Canvas */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div
            className={cn(
              'relative overflow-hidden rounded-xl border-2',
              hasDrawn ? 'border-brand-teal' : 'border-dashed border-zinc-300'
            )}
          >
            <canvas
              ref={canvasRef}
              width={500}
              height={200}
              className="h-[min(180px,32dvh)] w-full touch-none cursor-crosshair bg-white"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
            {!hasDrawn && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-1 text-zinc-300">
                  <Pencil className="size-6" />
                  <span className="text-sm font-medium">Draw your signature</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-4 sm:px-5">
          <button
            type="button"
            onClick={clearSignature}
            disabled={!hasDrawn}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              hasDrawn
                ? 'text-red-500 hover:bg-red-50'
                : 'text-zinc-300 cursor-not-allowed'
            )}
          >
            <X className="size-4" />
            Clear
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!hasDrawn}
              className={cn(
                'min-h-11 rounded-lg px-5 py-2 text-sm font-medium transition-colors',
                hasDrawn
                  ? 'bg-brand-teal text-white hover:bg-brand-teal/80'
                  : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
              )}
            >
              {hasDrawn ? 'Use Signature' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
