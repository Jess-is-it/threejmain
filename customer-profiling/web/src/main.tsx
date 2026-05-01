import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './css/globals.css';
import App from './App';
import Spinner from './views/spinner/Spinner';
import { CustomizerContextProvider } from './context/CustomizerContext';
import { SidebarProvider } from './context/sidebar-context';
import './utils/i18n';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <CustomizerContextProvider>
    <SidebarProvider>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<Spinner />}>
          <App />
        </Suspense>
      </QueryClientProvider>
    </SidebarProvider>
  </CustomizerContextProvider>,
);
