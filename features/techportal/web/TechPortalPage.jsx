import React from 'react'
import './techPortal.css'

const features = [
  {
    title: 'Dashboard',
    body: 'Assigned work, urgent tickets, route summary, and quick field status actions.',
  },
  {
    title: 'Ticketing',
    body: 'Technician queue, ticket detail, status updates, notes, checklists, and evidence capture.',
  },
  {
    title: 'Logs',
    body: 'Technician-scoped activity history for ticket actions, notes, uploads, and provisioning requests.',
  },
  {
    title: 'System Settings',
    body: 'Portal-safe profile, session, notification, device, and future offline sync preferences.',
  },
]

export default function TechPortalPage() {
  return (
    <main className="techportal-page">
      <section className="techportal-header">
        <div>
          <p className="techportal-kicker">Planned technician portal</p>
          <h1>Tech Portal</h1>
          <p>
            Technician-only workspace for assigned field work, ticket execution, evidence capture,
            activity history, and portal-safe settings.
          </p>
        </div>
        <span className="techportal-route">/techportal</span>
      </section>

      <section className="techportal-grid" aria-label="Tech Portal feature folders">
        {features.map((feature) => (
          <article className="techportal-card" key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="techportal-panel">
        <h2>Primary Flow</h2>
        <ol>
          <li>Technician signs in and sees assigned tickets.</li>
          <li>Technician opens a ticket and updates work status.</li>
          <li>Technician records checklist, notes, photos, readings, and materials used.</li>
          <li>Ticketing, Logs, Service, Inventory, and Network Settings receive the relevant updates.</li>
        </ol>
      </section>
    </main>
  )
}
