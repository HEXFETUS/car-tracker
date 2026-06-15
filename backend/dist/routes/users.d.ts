import { type Router as ExpressRouter } from 'express';
declare const router: ExpressRouter;
export interface SanitisedUser {
    id: string;
    name: string;
    username: string;
    userType: string;
    department: string;
    createdAt: string;
    updatedAt: string;
}
export default router;
//# sourceMappingURL=users.d.ts.map