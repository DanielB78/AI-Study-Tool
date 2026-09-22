import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalDistributeCenter,
  AlignHorizontalDistributeCenter,
  BringToFront,
  SendToBack,
  ArrowUpToLine,
  ArrowDownToLine,
  Copy,
  Lock,
  Unlock,
} from 'lucide-react';
import { CtxPopover } from './CtxPopover';

interface ArrangePopoverProps {
  count: number;
  locked: boolean;
  onAlign: (
    mode:
      | 'left'
      | 'centerX'
      | 'right'
      | 'top'
      | 'centerY'
      | 'bottom'
      | 'distributeX'
      | 'distributeY',
  ) => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
}

export function ArrangePopover({
  count,
  locked,
  onAlign,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onDuplicate,
  onToggleLock,
}: ArrangePopoverProps) {
  return (
    <CtxPopover label="Arrange" wide>
      <div className="arrange-grid">
        <button type="button" className="ctx-icon-btn" title="Bring to front" onClick={onBringToFront}>
          <BringToFront size={16} />
        </button>
        <button type="button" className="ctx-icon-btn" title="Bring forward" onClick={onBringForward}>
          <ArrowUpToLine size={16} />
        </button>
        <button type="button" className="ctx-icon-btn" title="Send backward" onClick={onSendBackward}>
          <ArrowDownToLine size={16} />
        </button>
        <button type="button" className="ctx-icon-btn" title="Send to back" onClick={onSendToBack}>
          <SendToBack size={16} />
        </button>
        <button type="button" className="ctx-icon-btn" title="Duplicate" onClick={onDuplicate}>
          <Copy size={16} />
        </button>
        <button
          type="button"
          className="ctx-icon-btn"
          title={locked ? 'Unlock' : 'Lock'}
          onClick={onToggleLock}
        >
          {locked ? <Unlock size={16} /> : <Lock size={16} />}
        </button>
      </div>

      {count >= 2 && (
        <>
          <div className="popover-label">Align</div>
          <div className="arrange-grid">
            <button type="button" className="ctx-icon-btn" title="Align left" onClick={() => onAlign('left')}>
              <AlignLeft size={16} />
            </button>
            <button type="button" className="ctx-icon-btn" title="Align centre" onClick={() => onAlign('centerX')}>
              <AlignCenter size={16} />
            </button>
            <button type="button" className="ctx-icon-btn" title="Align right" onClick={() => onAlign('right')}>
              <AlignRight size={16} />
            </button>
            <button type="button" className="ctx-icon-btn" title="Align top" onClick={() => onAlign('top')}>
              <AlignLeft size={16} style={{ transform: 'rotate(90deg)' }} />
            </button>
            <button type="button" className="ctx-icon-btn" title="Align middle" onClick={() => onAlign('centerY')}>
              <AlignCenter size={16} style={{ transform: 'rotate(90deg)' }} />
            </button>
            <button type="button" className="ctx-icon-btn" title="Align bottom" onClick={() => onAlign('bottom')}>
              <AlignRight size={16} style={{ transform: 'rotate(90deg)' }} />
            </button>
          </div>
        </>
      )}

      {count >= 3 && (
        <>
          <div className="popover-label">Distribute</div>
          <div className="arrange-grid">
            <button
              type="button"
              className="ctx-icon-btn"
              title="Distribute horizontally"
              onClick={() => onAlign('distributeX')}
            >
              <AlignHorizontalDistributeCenter size={16} />
            </button>
            <button
              type="button"
              className="ctx-icon-btn"
              title="Distribute vertically"
              onClick={() => onAlign('distributeY')}
            >
              <AlignVerticalDistributeCenter size={16} />
            </button>
          </div>
        </>
      )}
    </CtxPopover>
  );
}
