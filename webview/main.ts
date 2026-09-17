import './styles.css';
import { mountViewer } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Viewer root is missing');
mountViewer(root);
