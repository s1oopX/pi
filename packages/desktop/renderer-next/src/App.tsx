import { useEffect } from "react";
import { Layout } from "./components/Layout";
import { TopBar } from "./components/TopBar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { StatusBar } from "./components/StatusBar";
import { Settings } from "./components/Settings";
import { ToastContainer } from "./components/Toast";
import { useBackendEvents } from "./ipc/events";
import { useStore } from "./store";

export function App() {
  const initialize = useStore((s) => s.initialize);
  const settingsRoute = useStore((s) => s.settingsRoute);

  useBackendEvents();

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <>
      <Layout>
        <TopBar />
        <MessageList />
        <Composer />
        <StatusBar />
      </Layout>
      {settingsRoute && <Settings />}
      <ToastContainer />
    </>
  );
}
