import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

type CanvasToolButtonProps = {
  label: string;
  active?: boolean;
  agentTarget?: string;
  children: ReactNode;
  disabled?: boolean;
  nativeTooltip?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

export function CanvasToolButton({
  label,
  active,
  agentTarget,
  children,
  disabled,
  nativeTooltip = false,
  onClick,
}: CanvasToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-canvas-agent-target={agentTarget}
      data-tooltip={nativeTooltip ? undefined : label}
      title={nativeTooltip ? label : undefined}
      className={active ? "is-active" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type CanvasPopoverMenuButtonProps = {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
};

export function CanvasPopoverMenuButton({
  active,
  children,
  disabled,
  icon,
  onClick,
}: CanvasPopoverMenuButtonProps) {
  return (
    <button
      type="button"
      className={active ? "is-active" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
