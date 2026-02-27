import { Router, type IRouter } from 'express';
import authRouter from './auth';
import botsRouter from './bots';
import linksRouter from './links';
import resourcesRouter from './resources';
import resourceGroupsRouter from './resourceGroups';
import contentsRouter from './contents';
import adsRouter from './ads';
import usersRouter from './users';
import statsRouter from './stats';
import settingsRouter from './settings';

const router: IRouter = Router();

router.use('/auth', authRouter);
router.use('/bots', botsRouter);
router.use('/bots', linksRouter);
router.use('/resources', resourcesRouter);
router.use('/resource-groups', resourceGroupsRouter);
router.use('/links', contentsRouter);
router.use('/links', adsRouter);
router.use('/users', usersRouter);
router.use('/stats', statsRouter);
router.use('/settings', settingsRouter);

export default router;
