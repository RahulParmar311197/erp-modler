import type { ReactNode } from "react";

export type DocumentFlowStep = {
  key: string;
  label: string;
  number?: string | null;
  status: "done" | "current" | "pending" | "disabled";
  onClick?: () => void;
};

type DocumentFlowProps = {
  steps: DocumentFlowStep[];
  children?: ReactNode;
};

export function DocumentFlow({
  steps,
  children,
}: DocumentFlowProps) {
  return (
    <div className="document-flow">
      <div className="document-flow-track">
        {steps.map((step, index) => (
          <div className="document-flow-item" key={step.key}>
            <button
              type="button"
              className={`document-flow-step ${step.status}`}
              onClick={step.onClick}
              disabled={!step.onClick || step.status === "disabled"}
            >
              <span className="document-flow-icon">
                {step.status === "done"
                  ? "✓"
                  : index + 1}
              </span>

              <span className="document-flow-label">
                <strong>{step.label}</strong>

                {step.number && (
                  <small>{step.number}</small>
                )}
              </span>
            </button>

            {index < steps.length - 1 && (
              <span
                className={`document-flow-line ${
                  step.status === "done"
                    ? "completed"
                    : ""
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {children}
    </div>
  );
}
