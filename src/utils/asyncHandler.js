export const asyncHandler = (requestHandler) => async (req , res , next) =>{
    try {
        requestHandler(req , res, next);
    } catch (error) {
        next(error);
    }
}

