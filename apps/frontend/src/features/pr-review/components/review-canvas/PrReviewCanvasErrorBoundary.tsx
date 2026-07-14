"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

type PrReviewCanvasErrorBoundaryProps = {
  backLabel: string;
  children: ReactNode;
  onBackToSelection: () => void;
};

type PrReviewCanvasErrorBoundaryState = {
  error: Error | null;
};

export class PrReviewCanvasErrorBoundary extends Component<
  PrReviewCanvasErrorBoundaryProps,
  PrReviewCanvasErrorBoundaryState
> {
  state: PrReviewCanvasErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("PR Review Canvas rendering failed.", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-50 p-6 text-slate-950">
        <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertTriangle className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">리뷰 Canvas를 열지 못했습니다</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            리뷰 데이터는 유지되어 있습니다. 다시 시도하거나{
            ` ${this.props.backLabel} `}
            돌아가주세요.
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button
              onClick={this.props.onBackToSelection}
              type="button"
              variant="outline"
            >
              <ArrowLeft className="size-4" />
              {this.props.backLabel}
            </Button>
            <Button onClick={this.handleRetry} type="button">
              <RefreshCcw className="size-4" />
              다시 시도
            </Button>
          </div>
        </section>
      </div>
    );
  }
}
