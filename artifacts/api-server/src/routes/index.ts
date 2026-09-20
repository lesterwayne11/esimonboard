import { Router, type IRouter } from "express";
import healthRouter from "./health";
import esimRouter from "./esim";

const router: IRouter = Router();

router.use(healthRouter);
router.use(esimRouter);

export default router;
