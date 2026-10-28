import ReactDOM from 'react-dom/client';
import '@douyinfe/semi-ui/dist/css/semi.min.css';
import './styles.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}