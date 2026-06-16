import { Router, type IRouter } from "express";
import healthRouter from "./health";
import swapRouter from "./swap";
import walletRouter from "./wallet";
import configRouter from "./config";
import poolRouter from "./pool";

const router: IRouter = Router();

router.use(healthRouter);
router.use(swapRouter);
router.use(walletRouter);
router.use(configRouter);
router.use(poolRouter);

export default router;
