import { lazy } from 'react';
import { createBrowserRouter } from 'react-router';
import Loadable from '../layouts/full/shared/loadable/Loadable';
import { WEB_BASE_PATH } from '../config/env';

const FullLayout = Loadable(lazy(() => import('../layouts/full/FullLayout')));

const DashboardPage = Loadable(lazy(() => import('../features/meta/DashboardPage')));
const CustomersListPage = Loadable(lazy(() => import('../features/customers/CustomersListPage')));
const CustomerFormPage = Loadable(lazy(() => import('../features/customers/CustomerFormPage')));
const CustomerDetailsPage = Loadable(lazy(() => import('../features/customers/CustomerDetailsPage')));
const ServiceAssignmentPage = Loadable(
  lazy(() => import('../features/customers/ServiceAssignmentPage')),
);
const AuditLogsPage = Loadable(lazy(() => import('../features/audit/AuditLogsPage')));
const ApiPage = Loadable(lazy(() => import('../features/meta/ApiPage')));
const AiPromptPage = Loadable(lazy(() => import('../features/meta/AiPromptPage')));
const UpdatesPage = Loadable(lazy(() => import('../features/meta/UpdatesPage')));

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <FullLayout />,
      children: [
        { path: '/', element: <DashboardPage /> },
        { path: '/customers', element: <CustomersListPage /> },
        { path: '/customers/new', element: <CustomerFormPage /> },
        { path: '/customers/:id', element: <CustomerDetailsPage /> },
        { path: '/customers/:id/edit', element: <CustomerFormPage /> },
        { path: '/customers/:id/service-assignment', element: <ServiceAssignmentPage /> },
        { path: '/audit-logs', element: <AuditLogsPage /> },
        { path: '/api-page', element: <ApiPage /> },
        { path: '/ai-prompt', element: <AiPromptPage /> },
        { path: '/updates', element: <UpdatesPage /> },
      ],
    },
  ],
  { basename: WEB_BASE_PATH },
);

export default router;
