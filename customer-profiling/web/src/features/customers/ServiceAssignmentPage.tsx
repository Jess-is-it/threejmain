import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api, fetchJson } from '../common/http';

export default function ServiceAssignmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    planId: '',
    serviceId: '',
    startDate: '',
    endDate: '',
    status: 'ACTIVE',
  });

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson(`${api.customers}/${id}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          planId: form.planId || undefined,
          serviceId: form.serviceId || undefined,
          endDate: form.endDate || undefined,
        }),
      }),
    onSuccess: () => navigate(`/customers/${id}?tab=services`),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Service Assignment</h1>
      <form className="space-y-3 rounded border bg-white p-4" onSubmit={onSubmit}>
        {Object.entries(form).map(([key, value]) => (
          <label className="block space-y-1" key={key}>
            <span className="text-sm capitalize">{key}</span>
            {key === 'status' ? (
              <select
                className="w-full rounded border px-3 py-2"
                value={value}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
              >
                {['ACTIVE', 'PAUSED', 'TERMINATED', 'PENDING'].map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="w-full rounded border px-3 py-2"
                type={key.includes('Date') ? 'date' : 'text'}
                value={value}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
              />
            )}
          </label>
        ))}

        <div className="flex gap-2">
          <button className="rounded bg-blue-600 px-3 py-2 text-white" type="submit">
            {mutation.isPending ? 'Assigning...' : 'Assign'}
          </button>
          <Link className="rounded border px-3 py-2" to={`/customers/${id}?tab=services`}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
