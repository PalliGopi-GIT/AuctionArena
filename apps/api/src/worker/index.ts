import { createWorkerApp } from './app';

const app = createWorkerApp();
export { RoomDurableObject } from './room-do';
export { DirectoryDurableObject } from './directory-do';
export default { fetch: app.fetch };
