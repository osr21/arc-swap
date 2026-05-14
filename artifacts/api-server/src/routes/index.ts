import { Router, type IRouter } from "express";
import healthRouter from "./health";
import swapRouter from "./swap";
import walletRouter from "./wallet";

const router: IRouter = Router();

router.use(healthRouter);
router.use(swapRouter);
router.use(walletRouter);

export default router;
