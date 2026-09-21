import { Router, type IRouter } from "express";
import healthRouter from "./health";
import esimRouter from "./esim";
import authRouter from "./auth";
import customerRouter from "./customer";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(esimRouter);
router.use(authRouter);
router.use(customerRouter);
router.use(adminRouter);

export default router;
