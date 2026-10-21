import './App.css'
import { SubmissionForm } from './SubmissionForm'

function App() {
  return (
    <div className="shell">
      <header className="shell-header">
        <p className="eyebrow">Property &amp; Casualty · Underwriting</p>
        <h1>Risk Triage Agent</h1>
        <p className="subhead">
          Three independent risk assessments run in parallel, then a human
          makes the bind/refer call — every decision signed into an
          append-only audit ledger.
        </p>
      </header>
      <SubmissionForm />
    </div>
  )
}

export default App
