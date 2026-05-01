import { RouterProvider } from 'react-router';
import router from './routes/Router';
import './css/globals.css';
import { Toaster } from './components/ui/toaster';

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}
