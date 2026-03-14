import express from 'express';
import {
    adminLogin,
    register,
    login,
    adminLogout
} from '../controllers/authController.js';

// Authentication Router
const authRouter = express.Router();

authRouter.post('/register', register);
authRouter.post('/user-login', login);
authRouter.post('/admin-login' , adminLogin);
authRouter.post('/admin-logout', adminLogout);

export default authRouter;



