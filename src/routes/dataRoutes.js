import express from "express";
import {
    addDataForTimeSlot,
    getDataForDate,
    addOverlimitData,
    saveDemandRecords,
    getDemandOverlimit,
    getAllDocuments,
    deleteDataObjectById,
    getWinningNumbers,
    setWinningNumbers,
    updateWinningNumbers,
    deleteWinningNumbers,
    deleteIndividualEntries,
    getCombinedVoucherData,
    getDataForClient,
    checkOverlimitExists,
    deleteDemandForClient,
    searchBundleEntries
} from "../controllers/dataController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const dataRouter = express.Router();

dataRouter.post("/add-data", authMiddleware, addDataForTimeSlot);
dataRouter.post("/add-overlimit-data", authMiddleware, addOverlimitData); // this is used to add overlimit data and is used in the frontend to add overlimit data
dataRouter.post('/save-demand', authMiddleware, saveDemandRecords); // save demand records after Analyze
dataRouter.get("/get-data", authMiddleware, getDataForDate); // this is used to get data for a specific date or slot and is used in the frontend to get data for a specific date or slot
dataRouter.get("/get-client-data", authMiddleware, getDataForClient); // this is used by distributors to get data for their clients based on date, timeSlot, category, and userId
dataRouter.get("/get-demand-overlimit", authMiddleware, getDemandOverlimit); // this is used to get demand overlimit data
dataRouter.get("/get-all-documents",  getAllDocuments);  // this is used to get all documents for a specific user and is used in the frontend to get all documents for a specific user
dataRouter.delete("/delete-data/:id", authMiddleware,  deleteDataObjectById); // this is used to delete a specific data object by id and is used in the frontend to delete a specific data object by id
dataRouter.get("/get-winning-numbers", authMiddleware, getWinningNumbers); // this is used to get winning numbers for a specific date and time slot
dataRouter.post("/set-winning-numbers", authMiddleware, setWinningNumbers); // this is used to set winning numbers for a specific date and time slot
dataRouter.put("/update-winning-numbers", authMiddleware, updateWinningNumbers); // update winning numbers for a specific date
dataRouter.delete("/delete-winning-numbers", authMiddleware, deleteWinningNumbers); // delete winning numbers for a specific date
dataRouter.delete('/delete-individual-entries', authMiddleware, deleteIndividualEntries); // this is used to delete individual entries based on provided IDs
dataRouter.get('/get-combined-voucher-data', authMiddleware, getCombinedVoucherData); // this is used to get combined voucher data
dataRouter.get('/check-overlimit-exists', authMiddleware, checkOverlimitExists); // this is used to check if overlimit exists)
dataRouter.post('/delete-demand-for-client', authMiddleware, deleteDemandForClient); // delete demand records for a specific client/draw/prizeType
dataRouter.get('/search-bundle', authMiddleware, searchBundleEntries); // search bundle entries by draw and NO; distributor gets client-wise results

export default dataRouter;