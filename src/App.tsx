import { InfiniteCanvas } from './canvas/InfiniteCanvas';
import { Toolbar } from './components/Toolbar';

export default function App() {
  return (
    <div className="app-shell">
      <Toolbar />
      <main className="app-main">
        <InfiniteCanvas />
      </main>
    </div>
  );
}
