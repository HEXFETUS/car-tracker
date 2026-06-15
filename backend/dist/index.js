import app from './app.js';
import { PORT } from './config/env.js';
app.listen(PORT, () => {
    console.log(`🚗 Car Tracker API running on http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map