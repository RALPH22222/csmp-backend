import { supabase } from "./config/supabase.js";

async function run() {
  const { data } = await supabase.from('pools').select('*').limit(1);
  console.log(JSON.stringify(data[0], null, 2));
}

run();
