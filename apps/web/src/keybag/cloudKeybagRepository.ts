import type { SupabaseClient } from '@supabase/supabase-js';
import type { SolanaKeybagCryptoPayload, SolanaKeybagRow } from './cloudKeybagCrypto';

export async function fetchKeybagForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<SolanaKeybagRow | null> {
  const { data, error } = await supabase.from('solana_keybags').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as SolanaKeybagRow;
}

export async function insertKeybag(
  supabase: SupabaseClient,
  userId: string,
  payload: SolanaKeybagCryptoPayload,
): Promise<void> {
  const { error } = await supabase.from('solana_keybags').insert({
    user_id: userId,
    pubkey: payload.pubkey,
    pwd_salt: payload.pwd_salt,
    pwd_iv: payload.pwd_iv,
    pwd_wrap: payload.pwd_wrap,
    rec_salt: payload.rec_salt,
    rec_iv: payload.rec_iv,
    rec_wrap: payload.rec_wrap,
    sk_iv: payload.sk_iv,
    sk_ciphertext: payload.sk_ciphertext,
  });
  if (error) throw new Error(error.message);
}

export async function updateKeybagPasswordWrap(
  supabase: SupabaseClient,
  userId: string,
  patch: Pick<SolanaKeybagCryptoPayload, 'pwd_salt' | 'pwd_iv' | 'pwd_wrap'>,
): Promise<void> {
  const { error } = await supabase
    .from('solana_keybags')
    .update({
      pwd_salt: patch.pwd_salt,
      pwd_iv: patch.pwd_iv,
      pwd_wrap: patch.pwd_wrap,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}
