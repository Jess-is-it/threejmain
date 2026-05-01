import { Activity, FC, useContext } from 'react';
import { Outlet } from 'react-router';
import { Customizer } from './shared/customizer/Customizer';
import { CustomizerContext } from '../../context/CustomizerContext';
import Sidebar from './vertical/sidebar/Sidebar';
import Header from './vertical/header/Header';
import { SidebarProvider } from 'src/components/ui/sidebar';
import { APP_VERSION } from '../../config/env';

const FullLayout: FC = () => {
  const { activeLayout, isLayout } = useContext(CustomizerContext);

  return (
    <SidebarProvider>
      <div className="flex w-full min-h-screen">
        <div className="page-wrapper flex w-full">
          <Activity mode={activeLayout == 'vertical' ? 'visible' : 'hidden'}>
            <div className="hidden xl:block">
              <Sidebar />
            </div>
          </Activity>

          <div className="body-wrapper flex w-full flex-col bg-white dark:bg-dark">
            <Header layoutType={activeLayout == 'horizontal' ? 'horizontal' : 'vertical'} />

            <div
              className={`flex-1 ${
                isLayout == 'full'
                  ? 'w-full py-[30px] md:px-[30px] px-5'
                  : 'container mx-auto  py-[30px]'
              } ${activeLayout == 'horizontal' ? 'xl:mt-3' : ''}`}
            >
              <main className="flex-grow">
                <Outlet />
              </main>
            </div>

            <footer className="border-t px-5 py-3 text-xs text-gray-500 md:px-[30px]">
              THREE3J Customer Profiling v{APP_VERSION}
            </footer>
            <Customizer />
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default FullLayout;
