import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-foreground">Нещо се обърка</h1>
            <p className="text-sm text-muted-foreground">
              Възникна неочаквана грешка. Опитайте да презаредите страницата.
            </p>
            {this.state.error && (
              <p className="text-xs text-muted-foreground/70 font-mono mt-2 break-all">
                {this.state.error.message}
              </p>
            )}
          </div>
          <Button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Презареди
          </Button>
        </div>
      </div>
    );
  }
}
