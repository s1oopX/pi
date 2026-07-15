import type { ReactNode } from "react";
import { useStore } from "../../store";

interface ActionCard {
  title: string;
  description: string;
  prompt: string;
  icon: ReactNode;
}

const ACTION_CARDS: ActionCard[] = [
  {
    title: "Explore the codebase",
    description: "Understand the structure and how things fit together",
    prompt: "Explore this codebase and give me an overview of its structure, main modules, and how they fit together.",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m20 20-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Build a new feature",
    description: "Add functionality or a new tool to the project",
    prompt: "I want to build a new feature. Help me plan and implement it. Here is what I have in mind: ",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Review changes",
    description: "Get feedback and suggested improvements",
    prompt: "Review the recent changes in this repository and suggest improvements.",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Fix a problem",
    description: "Diagnose an error or failing behavior",
    prompt: "I'm hitting a problem. Help me diagnose and fix it. Here are the details: ",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 9v4M12 17h.01" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function EmptyState() {
  const models = useStore((s) => s.models);
  const openSettings = useStore((s) => s.openSettings);
  const setComposerDraft = useStore((s) => s.setComposerDraft);

  // No models configured yet: guide the user to set one up instead of letting
  // them type a message that would fail with no model to run it.
  if (models.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40">
            <rect x="3" y="4" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 21h8M12 18v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="empty-state-title">No model configured</h2>
        <p className="empty-state-subtitle">
          Add a provider and pick a model to start chatting.
        </p>
        <button
          className="empty-state-cta"
          type="button"
          onClick={() => openSettings("custom-providers")}
        >
          Open settings to configure a model
        </button>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40" height="40">
          <path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="empty-state-title">What should we work on?</h2>
      <p className="empty-state-subtitle">
        Pick a starting point, or just type a message below.
      </p>
      <div className="empty-state-cards">
        {ACTION_CARDS.map((card) => (
          <button
            key={card.title}
            className="empty-state-card"
            type="button"
            onClick={() => setComposerDraft(card.prompt)}
          >
            <span className="empty-state-card-icon" aria-hidden="true">{card.icon}</span>
            <span className="empty-state-card-title">{card.title}</span>
            <span className="empty-state-card-desc">{card.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
