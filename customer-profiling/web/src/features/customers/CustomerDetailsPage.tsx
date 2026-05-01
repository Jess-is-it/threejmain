import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams, useParams } from 'react-router';
import { api, fetchJson, ListResponse } from '../common/http';
import { AuditLog, Customer, CustomerService } from './types';

export default function CustomerDetailsPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'profile';

  const customer = useQuery({
    queryKey: ['customer', id],
    queryFn: () => fetchJson<Customer>(`${api.customers}/${id}`),
  });

  const services = useQuery({
    queryKey: ['customer-services', id],
    queryFn: () => fetchJson<CustomerService[]>(`${api.customers}/${id}/services`),
  });

  const audit = useQuery({
    queryKey: ['customer-audit', id],
    queryFn: () =>
      fetchJson<ListResponse<AuditLog>>(
        `${api.auditLogs}?entityType=Customer&search=${encodeURIComponent(id)}&page=1&pageSize=20`,
      ),
  });

  if (customer.isLoading) {
    return <div>Loading...</div>;
  }

  if (!customer.data) {
    return <div>Customer not found.</div>;
  }

  const secondaryContacts =
    customer.data.secondaryContacts && customer.data.secondaryContacts.length > 0
      ? customer.data.secondaryContacts
      : customer.data.secondaryContactName
        ? [
            {
              name: customer.data.secondaryContactName,
              contactNumber: customer.data.secondaryContactNumber,
              facebookAccount: customer.data.secondaryContactFacebookAccount,
              relationship: customer.data.secondaryContactRelationship,
            },
          ]
        : [];

  const latitude =
    customer.data.latitude === null || customer.data.latitude === undefined
      ? null
      : Number(customer.data.latitude);
  const longitude =
    customer.data.longitude === null || customer.data.longitude === undefined
      ? null
      : Number(customer.data.longitude);
  const hasCoordinates =
    latitude !== null && longitude !== null && !Number.isNaN(latitude) && !Number.isNaN(longitude);
  const mapEmbedUrl = hasCoordinates
    ? `https://maps.google.com/maps?q=${latitude},${longitude}&z=16&output=embed`
    : '';
  const mapOpenUrl = hasCoordinates
    ? `https://www.google.com/maps?q=${latitude},${longitude}`
    : '';
  const fullName = [customer.data.firstName, customer.data.middleName, customer.data.lastName]
    .filter(Boolean)
    .join(' ');
  const fullAddress = [
    customer.data.addressLine1,
    customer.data.addressLine2,
    customer.data.barangay,
    customer.data.city,
    customer.data.province,
  ]
    .filter(Boolean)
    .join(', ');
  const normalizeExternalUrl = (value: string) =>
    /^https?:\/\//i.test(value) ? value : `https://${value}`;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">{fullName}</h1>
            <p className="mt-1 text-sm text-gray-500">{customer.data.accountNumber}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
                href={`tel:${customer.data.contactNumber}`}
              >
                📞 {customer.data.contactNumber}
              </a>
              <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                📍 {customer.data.barangay}, {customer.data.city}, {customer.data.province}
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <Link
              className="rounded-lg border border-blue-300 bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              to={`/customers/${id}/edit`}
            >
              Edit
            </Link>
            <Link
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              to="/customers"
            >
              Back
            </Link>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {['profile', 'services', 'audit'].map((name) => (
          <button
            className={`rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition ${
              tab === name
                ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            key={name}
            onClick={() => setParams({ tab: name })}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Profile Information</p>
            <div className="mt-3 space-y-2">
              <p className="text-sm text-gray-500">Address</p>
              <p className="text-base text-gray-900">{fullAddress || '-'}</p>
            </div>

            <div className="mt-6 grid gap-8 md:grid-cols-2">
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contact</p>
                <FieldItem
                  label="Contact Number"
                  value={
                    <a className="text-blue-700 hover:underline" href={`tel:${customer.data.contactNumber}`}>
                      {customer.data.contactNumber}
                    </a>
                  }
                />
                <FieldItem label="Alternate Mobile" value={customer.data.alternateMobileNumber || '-'} />
                <FieldItem
                  label="Email"
                  value={
                    customer.data.email ? (
                      <a className="text-blue-700 hover:underline" href={`mailto:${customer.data.email}`}>
                        {customer.data.email}
                      </a>
                    ) : (
                      '-'
                    )
                  }
                />
              </div>

              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Social & Location</p>
                <FieldItem label="Facebook Account" value={customer.data.facebookAccountName || '-'} />
                <FieldItem
                  label="Facebook Profile Link"
                  value={
                    customer.data.facebookProfileLink ? (
                      <a
                        className="text-blue-700 hover:underline"
                        href={customer.data.facebookProfileLink}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {customer.data.facebookProfileLink}
                      </a>
                    ) : (
                      '-'
                    )
                  }
                />
                <FieldItem
                  label="GPS Coordinates"
                  value={hasCoordinates ? `${latitude}, ${longitude}` : '-'}
                />
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Map</p>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {hasCoordinates ? (
                <iframe
                  className="h-[200px] w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={mapEmbedUrl}
                  title="Customer Location Map"
                />
              ) : (
                <div className="flex h-[200px] items-center justify-center text-sm text-slate-500">
                  Map preview unavailable
                </div>
              )}
            </div>
            {hasCoordinates && (
              <a
                className="inline-block text-sm font-medium text-blue-700 hover:underline"
                href={mapOpenUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                View on map
              </a>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-slate-900">Secondary Contacts</h2>
            {secondaryContacts.length === 0 && (
              <p className="text-sm text-gray-500">No secondary contacts available</p>
            )}
            {secondaryContacts.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {secondaryContacts.map((contact, index) => (
                  <div
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                    key={`${contact.name}-${index}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-base font-semibold text-slate-900">{contact.name || '-'}</p>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {contact.relationship || 'N/A'}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      <p className="flex items-center gap-2">
                        <span>📞</span>
                        {contact.contactNumber ? (
                          <a className="text-blue-700 hover:underline" href={`tel:${contact.contactNumber}`}>
                            {contact.contactNumber}
                          </a>
                        ) : (
                          '-'
                        )}
                      </p>
                      <p className="flex items-center gap-2">
                        <span>ⓕ</span>
                        <span>{contact.facebookAccount || '-'}</span>
                      </p>
                      <p className="flex items-center gap-2">
                        <span>🔗</span>
                        {contact.facebookProfileLink ? (
                          <a
                            className="text-blue-700 hover:underline"
                            href={normalizeExternalUrl(contact.facebookProfileLink)}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {contact.facebookProfileLink}
                          </a>
                        ) : (
                          '-'
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Metadata</p>
            <div className="grid gap-4 text-sm text-slate-600 md:grid-cols-2">
              <div>
                <p className="text-xs text-slate-400">Created</p>
                <p>{new Date(customer.data.createdAt).toLocaleString()}</p>
                <p>By: {customer.data.createdByUserId || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Updated</p>
                <p>{new Date(customer.data.updatedAt).toLocaleString()}</p>
                <p>By: {customer.data.updatedByUserId || '-'}</p>
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === 'services' && (
        <div className="space-y-2 rounded border bg-white p-4">
          <div className="flex justify-between">
            <h2 className="text-lg font-medium">Services</h2>
            <Link className="text-blue-600" to={`/customers/${id}/service-assignment`}>
              Assign Service
            </Link>
          </div>
          {(services.data || []).map((item) => (
            <div className="rounded border p-2 text-sm" key={item.id}>
              <div>Plan: {item.planId || '-'}</div>
              <div>Service: {item.serviceId || '-'}</div>
              <div>Status: {item.status}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div className="rounded border bg-white p-4">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Timestamp</th>
                <th className="text-left">Action</th>
                <th className="text-left">Actor</th>
                <th className="text-left">Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data?.data || []).map((item) => (
                <tr className="border-t" key={item.id}>
                  <td>{new Date(item.timestamp).toLocaleString()}</td>
                  <td>{item.actionType}</td>
                  <td>{item.actorUsername || item.actorUserId}</td>
                  <td>{item.correlationId || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FieldItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-gray-500">{label}</p>
      <div className="text-base text-gray-900">{value}</div>
    </div>
  );
}
