import { InfiniteCanvas } from './canvas/InfiniteCanvas';
import { EditorChrome } from './components/toolbar/EditorChrome';

export default function App() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <InfiniteCanvas />
        <EditorChrome />
      </main>
    </div>
  );
}
