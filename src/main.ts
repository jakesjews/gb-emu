import { App } from './ui/App';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root element.');
}

new App(root);
