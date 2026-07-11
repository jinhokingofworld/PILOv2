import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type WorkspaceSelectionCardProps = {
  description: string;
  icon: ReactNode;
  onClick: () => void;
  selected: boolean;
  title: string;
};

type WorkspaceStep = {
  title: string;
};

export function WorkspaceSelectionCard({
  description,
  icon,
  onClick,
  selected,
  title
}: WorkspaceSelectionCardProps) {
  return (
    <Button
      aria-pressed={selected}
      className="h-auto min-h-20 justify-start gap-3 whitespace-normal px-4 py-3 text-left"
      onClick={onClick}
      variant={selected ? "secondary" : "outline"}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
        {icon}
      </span>
      <span className="grid flex-1 gap-1">
        <span className="font-medium">{title}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {description}
        </span>
      </span>
      {selected ? <Check className="text-primary" /> : null}
    </Button>
  );
}

export function WorkspaceSkippedStep({
  icon,
  text
}: {
  icon: ReactNode;
  text: string;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/20 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
        {icon}
      </div>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function WorkspaceStepIndicator({
  currentStep,
  steps
}: {
  currentStep: number;
  steps: readonly WorkspaceStep[];
}) {
  return (
    <nav
      aria-label="워크스페이스 생성 단계"
      className="grid grid-cols-5 gap-2"
    >
      {steps.map((item, index) => (
        <div className="grid gap-2" key={item.title}>
          <div
            className={cn(
              "h-1.5 rounded-full bg-border transition-colors",
              index <= currentStep && "bg-primary"
            )}
          />
          <p
            className={cn(
              "hidden text-xs font-medium sm:block",
              index === currentStep
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {index + 1}. {item.title}
          </p>
        </div>
      ))}
    </nav>
  );
}

export function WorkspaceCenteredStatus({
  action,
  icon,
  text
}: {
  action?: ReactNode;
  icon: ReactNode;
  text: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            {icon}
          </div>
          <p className="text-sm text-muted-foreground">{text}</p>
          {action}
        </CardContent>
      </Card>
    </main>
  );
}
