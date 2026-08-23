import { supabase } from '@/lib/supabase';

export type CommandCode = 'UNAUTHORIZED'|'INVALID_STATE_TRANSITION'|'NOT_FOUND'|'VALIDATION_FAILED'|'CONFLICT'|'CAPACITY_EXCEEDED'|'FISCAL_PERIOD_CLOSED'|'UNKNOWN';
export interface CommandResult<T> {
  success: boolean; data: T | null;
  error: {
    code: CommandCode|string;
    message: string;
    user_safe_message: string;
    details?: unknown;
    retryable: boolean;
    fieldErrors?: Record<string,string>;
  } | null;
  correlationId: string;
  operation?: string;
}

const USER_SAFE_MESSAGES: Record<string, string> = {
  'UNAUTHORIZED': 'غير مصرح لك بهذه العملية',
  'INVALID_STATE_TRANSITION': 'لا يمكن تنفيذ هذه العملية في الحالة الحالية',
  'NOT_FOUND': 'السجل المطلوب غير موجود',
  'VALIDATION_FAILED': 'البيانات المدخلة غير صحيحة، يرجى المراجعة',
  'CONFLICT': 'تعارض في البيانات — يرجى التحديث والمحاولة مجدداً',
  'CAPACITY_EXCEEDED': 'تجاوزت السعة المتاحة للباقة',
  'FISCAL_PERIOD_CLOSED': 'الفترة المالية مغلقة — تواصل مع مدير النظام',
  '23505': 'هذا السجل موجود مسبقاً (تعارض في البيانات)',
  '42501': 'غير مصرح لك بهذه العملية',
  'UNKNOWN': 'حدث خطأ غير متوقع، يرجى المحاولة مجدداً أو التواصل مع الدعم',
};

const cid=()=>crypto.randomUUID();
const mapError=(e:{message:string;code?:string}|null)=>e?{
  code:e.code??'UNKNOWN',
  message:e.message,
  user_safe_message: (USER_SAFE_MESSAGES[e.code??'UNKNOWN'] ?? 'Unknown Error'),
  retryable:['40001','57014','PGRST003'].includes(e.code??'')
}:null;
async function call<T>(fn:string,args:Record<string,unknown>):Promise<CommandResult<T>>{
  const correlationId=cid(); const {data,error}=await supabase.rpc(fn,args);
  return {success:!error,data:(data as T|null)??null,error:mapError(error),correlationId};
}
async function command<T>(fn: string, args: Record<string, unknown>): Promise<CommandResult<T>> {
  return call<T>(fn, args);
}

export const pilgrimCommands={
  create:(row:Record<string,unknown>)=>call<{id:string}>('create_pilgrim_command',{p_payload:row}),
  update:(id:string,patch:Record<string,unknown>)=>('status' in patch || 'visa_status' in patch)
    ? call<{id:string;status:string}>('transition_pilgrim_state',{p_pilgrim_id:id,p_to_status:String(patch.status??patch.visa_status)})
    : call<{id:string}>('update_pilgrim_profile_command',{p_pilgrim_id:id,p_payload:patch}),
  remove:(id:string)=>call<{id:string}>('delete_pilgrim_command',{p_pilgrim_id:id}),
};

export const visaCommands={
  create:(row:Record<string,unknown>)=>call<{id:string}>('create_visa_command',{p_payload:row}),
  /** Atomic: advances the visa stage AND syncs the linked pilgrim + audit trail in one transaction. */
  advanceStage:(visaId:string,toStatus:string)=>call<{id:string;status:string;pilgrim_id:string|null;from_status:string}>('advance_visa_stage_command',{p_visa_id:visaId,p_to_status:toStatus}),
  update:(id:string,patch:Record<string,unknown>)=>call<{id:string;status:string;pilgrim_id:string|null;from_status:string}>('advance_visa_stage_command',{p_visa_id:id,p_to_status:String(patch.status)}),
  /** Atomic: deletes the visa and resets the linked pilgrim visa_status. */
  remove:(id:string)=>call<{id:string;pilgrim_id:string|null}>('retire_visa_command',{p_visa_id:id}),
};


export const documentCommands={
  create:(row:Record<string,unknown>)=>call<{id:string}>('create_document_command',{p_payload:row}),
  update:(id:string,patch:Record<string,unknown>)=>('status' in patch && patch.status==='VERIFIED')
    ? call<{id:string;status:string}>('verify_document_command',{p_document_id:id})
    : command('update_document_command',{p_document_id:id,p_payload:patch}),
  remove:(id:string)=>call<{id:string}>('delete_document_command',{p_document_id:id}),
};

export const roomAllocationCommands={
  create:(row:Record<string,unknown>)=>call<{id:string}>('allocate_room_command',{p_payload:row}),
  update:(id:string,patch:Record<string,unknown>)=>command<{id:string}>('update_room_allocation_command',{p_id:id,p_payload:patch}),
  remove:(id:string)=>command<{id:string}>('delete_room_allocation_command',{p_id:id}),
};

export const groupCommands={
  create:(row:Record<string,unknown>)=>call<{id:string}>('create_group_command',{p_payload:row}),
  update:(id:string,patch:Record<string,unknown>)=>('status' in patch)
    ? call<{id:string;status:string}>('transition_group_state',{p_group_id:id,p_to_status:String(patch.status)})
    : command<{id:string}>('update_group_command',{p_id:id,p_payload:patch}),
  remove:(id:string)=>call<{id:string}>('delete_group_command',{p_group_id:id}),
};

const makeCrud=(createFn:string,updateFn:string,deleteFn:string)=>({
  create:(row:Record<string,unknown>)=>call<{id:string}>(createFn,{p_payload:row}),
  update:(id:string,patch:Record<string,unknown>)=>call<{id:string}>(updateFn,{p_id:id,p_payload:patch}),
  remove:(id:string)=>call<{id:string}>(deleteFn,{p_id:id}),
});
export const incidentCommands={create:(row:Record<string,unknown>)=>call<{id:string}>('create_incident_command',{p_payload:row}),update:(id:string,patch:Record<string,unknown>)=>('status'in patch?call<{id:string;status:string}>('transition_incident_state',{p_incident_id:id,p_to_status:String(patch.status)}):command<{id:string}>('update_incident_command',{p_id:id,p_payload:patch})),remove:(id:string)=>call<{id:string}>('delete_incident_command',{p_id:id})};
export const sosCommands=makeCrud('create_sos_event_command','update_sos_event_command','delete_sos_event_command');
export const transportVehicleCommands=makeCrud('create_transport_vehicle_command','update_transport_vehicle_command','delete_transport_vehicle_command');
export const transportAssignmentCommands=makeCrud('create_transport_assignment_command','update_transport_assignment_command','delete_transport_assignment_command');
export const hotelCommands=makeCrud('create_hotel_command','update_hotel_command','delete_hotel_command');
export const packageCommands=makeCrud('create_package_command','update_package_command','delete_package_command');
export const flightCommands=makeCrud('create_flight_command','update_flight_command','delete_flight_command');
export const holySiteCampCommands=makeCrud('create_camp_command','update_camp_command','delete_camp_command');
export const crmCommands=makeCrud('create_crm_lead_command','update_crm_lead_command','delete_crm_lead_command');

// ── Reservation / Booking commands ───────────────────────────────────────────
/** Typed result for reservation confirmation */
export interface ConfirmReservationResult {
  booking_reference: string;
  booking_id: string;
  pilgrim_id: string;
}

export const reservationCommands = {
  /**
   * Confirms a pending public reservation → creates Pilgrim + Booking + Payment
   * + Journal entries atomically.
   */
  confirm: (
    reservationId: string,
    packageId: string,
    groupId: string | null,
    passportNumber: string,
    paymentAmountDzd: number,
    paymentAmountSar: number,
    paymentMethod: string,
    notes: string | null,
  ) =>
    call<ConfirmReservationResult>('confirm_reservation_transaction', {
      p_reservation_id: reservationId,
      p_package_id: packageId,
      p_group_id: groupId,
      p_passport_number: passportNumber,
      p_payment_amount_dzd: paymentAmountDzd,
      p_payment_amount_sar: paymentAmountSar,
      p_payment_method: paymentMethod,
      p_notes: notes,
    }),

  /** Cancels a confirmed/paid booking and posts a reversal journal entry. */
  cancelBooking: (bookingId: string, reason = 'Cancelled by staff') =>
    call<{ id: string }>('cancel_booking_transaction', {
      p_booking_id: bookingId,
      p_reason: reason,
    }),

  /** Cancels / rejects a pending public reservation request. */
  cancelReservation: (reservationId: string, reason = 'Cancelled by staff') =>
    call<{ id: string }>('cancel_reservation_request', {
      p_reservation_id: reservationId,
      p_reason: reason,
    }),
};

// ── External Operations commands ───────────────────────────────────────────

export const externalOperationCommands = {
  create: (payload: Record<string, unknown>) =>
    call<{ id: string }>('create_external_operation', { p_payload: payload }),

  update: (id: string, payload: Record<string, unknown>) =>
    call<{ id: string }>('update_external_operation', { p_id: id, p_payload: payload }),

  remove: (id: string) =>
    call<{ id: string }>('delete_external_operation', { p_id: id }),

  attachEvidence: (
    operationId: string,
    storagePath: string,
    fileName: string,
    fileType?: string,
    description?: string,
    sizeBytes?: number,
    checksumSha256?: string
  ) =>
    call<{ id: string }>('attach_external_evidence', {
      p_operation_id: operationId,
      p_storage_bucket: 'documents',
      p_storage_path: storagePath,
      p_file_name: fileName,
      p_file_type: fileType ?? null,
      p_description: description ?? null,
      p_size_bytes: sizeBytes ?? null,
      p_checksum_sha256: checksumSha256 ?? null,
    }),
};

export const externalReferenceCommands = {
  add: (payload: Record<string, unknown>) =>
    call<{ id: string }>('add_external_reference', { p_payload: payload }),

  remove: (id: string) =>
    call<{ id: string }>('delete_external_reference', { p_id: id }),
};

export class CompatibilityCommands {
  static async executeUpdate<T>(tbl: string, id: string, payload: Record<string, unknown>, columns = '*'): Promise<{ data: T | null; error: Error | null }> {
    try {
      
      const result = await supabase.from(tbl as never).update(payload as never).eq('id', id).select(columns).single();
      if (result.error) throw result.error;
      return { data: result.data as T, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  }

  static async executeInsert<T>(tbl: string, payload: Record<string, unknown>, columns = '*'): Promise<{ data: T | null; error: Error | null }> {
    try {
      
      const result = await supabase.from(tbl as never).insert(payload as never).select(columns).single();
      if (result.error) throw result.error;
      return { data: result.data as T, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  }

  static async executeDelete(tbl: string, id: string): Promise<{ error: Error | null }> {
    try {
      
      const result = await supabase.from(tbl as never).delete().eq('id', id);
      if (result.error) throw result.error;
      return { error: null };
    } catch (e) {
      return { error: e as Error };
    }
  }
}



