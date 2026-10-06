import shell from 'virtual:wheelie-shell';
import { handleOxygenRequest, type OxygenEnvironment } from './runtime.js';

/** Oxygen serves dist/client static assets before reaching this worker. */
const worker = {
  fetch(request: Request, env: OxygenEnvironment) {
    return handleOxygenRequest(request, env, shell);
  },
};
export default worker;
