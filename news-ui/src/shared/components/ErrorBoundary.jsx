import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[Sense.AI] Application render failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="application-error" role="alert">
        <span>Sense.AI</span>
        <h1>This view could not be opened.</h1>
        <p>{this.state.error.message || "An unexpected interface error occurred."}</p>
        <button onClick={() => window.location.reload()} type="button">
          Reload application
        </button>
      </main>
    );
  }
}
