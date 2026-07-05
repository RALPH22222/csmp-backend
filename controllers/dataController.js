import { supabase } from '../config/supabase.js';

// GET: Fetch all messages
export const getMessages = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: false }); // Newest first

        if (error) throw error;

        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST: Add a new message
export const addMessage = async (req, res) => {
    try {
        const { content } = req.body;
        
        if (!content) {
            return res.status(400).json({ success: false, message: 'Message content is required' });
        }

        const { data, error } = await supabase
            .from('messages')
            .insert([{ content }])
            .select(); // Returns the newly created row

        if (error) throw error;

        return res.status(201).json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};