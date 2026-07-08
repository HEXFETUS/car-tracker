import { useRef, useState, useEffect, useCallback } from 'react';
import { X, Pencil } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface SignaturePadProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

export function SignaturePad({ value, onChange, disabled = false }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Initialize canvas with saved value or clear
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHasDrawn(true);
      };
      img.src = value;
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(false);
    }
  }, [value]);

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
    if (disabled) return;
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
    if (!isDrawing || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
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
    onChange(null);
  }

  function saveSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL('image/png'));
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border-2',
          hasDrawn ? 'border-brand-teal' : 'border-dashed border-brand-sage',
          disabled ? 'cursor-not-allowed opacity-60' : ''
        )}
      >
        <canvas
          ref={canvasRef}
          width={400}
          height={150}
          className="touch-none w-full h-[120px] bg-white cursor-crosshair"
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
              <Pencil className="size-5" />
              <span className="text-xs font-medium">Sign here</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        {hasDrawn ? (
          <button
            type="button"
            onClick={clearSignature}
            className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition-colors"
          >
            <X className="size-3.5" />
            Clear
          </button>
        ) : (
          <span className="text-xs text-zinc-400">Draw your signature above</span>
        )}
        {hasDrawn && !disabled && (
          <button
            type="button"
            onClick={saveSignature}
            className="text-xs text-brand-teal font-medium hover:text-brand-teal/80 transition-colors"
          >
            Save Signature
          </button>
        )}
      </div>
    </div>
  );
}