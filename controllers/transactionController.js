import { supabase } from "../config/supabase.js";

export const getUserHistory = async (req, res) => {
  try {
    const authenticatedUserId =
      req.user?.id || req.user?.sub || req.user?.userId;

    if (!authenticatedUserId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    // Fetch user's profile ID
    const { data: userProfile, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", authenticatedUserId)
      .single();

    if (userError || !userProfile) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Fetch pool transactions for this user
    const { data: poolMembers, error: membersError } = await supabase
      .from("pool_members")
      .select("id, pools(pool_name)")
      .eq("user_id", userProfile.id);

    if (membersError) throw membersError;

    const memberIds = poolMembers.map((pm) => pm.id);

    if (memberIds.length === 0) {
       return res.status(200).json({ success: true, data: [] });
    }

    const { data: transactions, error: txError } = await supabase
      .from("transactions")
      .select(`
        id,
        amount,
        executed_at,
        transaction_type:transaction_types(type_name),
        transaction_status:transaction_statuses(status_name),
        pool_member_id
      `)
      .in("pool_member_id", memberIds)
      .order("executed_at", { ascending: false });

    if (txError) throw txError;

    // Map to a unified format
    const formattedHistory = transactions.map((tx) => {
       const poolMember = poolMembers.find((pm) => pm.id === tx.pool_member_id);
       const typeName = tx.transaction_type?.type_name || "Unknown";
       
       // Format typeName to Title Case, e.g. "PAYOUT_PRINCIPAL" -> "Payout Principal"
       const formattedTypeName = typeName
         .split('_')
         .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
         .join(' ');
       
       const isOut = typeName.toLowerCase().includes("contribute");
       
       return {
         id: tx.id,
         title: `${formattedTypeName} - ${poolMember?.pools?.pool_name || 'Pool'}`,
         time: new Date(tx.executed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
         date: new Date(tx.executed_at).toLocaleDateString(),
         amount: isOut ? `-₱${tx.amount}` : `+₱${tx.amount}`,
         type: isOut ? "out" : "in",
         icon: isOut ? "arrow-up" : "arrow-down",
         color: isOut ? "#E53E3E" : "#006D77",
         rawDate: tx.executed_at
       };
    });

    return res.status(200).json({ success: true, data: formattedHistory });
  } catch (error) {
    console.error("Error fetching user history:", error);
    res.status(500).json({ success: false, error: "Failed to fetch history" });
  }
};
