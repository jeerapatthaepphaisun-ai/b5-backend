// controllers/utilityController.js

// POST /api/utils/upload-image
const uploadImage = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
        }

        const file = req.file;
        const fileExt = file.originalname.split('.').pop();
        const fileName = `menu-${Date.now()}.${fileExt}`;

        // Use the supabase instance passed via middleware in server.js
        const { data, error: uploadError } = await req.supabase.storage
            .from('menu-images')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                cacheControl: '3600',
                upsert: false,
            });

        if (uploadError) throw new Error(uploadError.message);

        const { data: urlData } = req.supabase.storage.from('menu-images').getPublicUrl(fileName);

        res.json({
            status: 'success',
            message: 'Image uploaded successfully.',
            data: { imageUrl: urlData.publicUrl }
        });
    } catch (error) {
        next(error);
    }
};

// GET /api/utils/health
const healthCheck = (req, res) => {
    // ฟังก์ชันนี้จะตอบกลับทันทีโดยไม่เชื่อมต่อฐานข้อมูล
    res.status(200).json({ status: 'success', message: 'Server is awake and healthy.' });
};

module.exports = {
    uploadImage,
    healthCheck
};