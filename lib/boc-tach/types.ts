export type HeaderStatus = 'NHAP' | 'DA_GUI' | 'TRA_LAI' | 'DA_DUYET_QLSX' | 'HUY'

export type BocTachHeaderInput = {
  da_id: string
  kh_id: string
  ma_coc?: string
  loai_coc: string
  do_ngoai: number
  chieu_day: number
  kg_md: number
  mac_be_tong: string
  cap_phoi_variant: string
  ten_boc_tach: string
  loai_thep: string
  phuong_thuc_van_chuyen: 'ROAD_WITH_CRANE' | 'ROAD_NO_CRANE' | 'WATERWAY' | 'OTHER'
  trang_thai: HeaderStatus
  do_mm: number
  t_mm: number
  pc_dia_mm: number
  pc_nos: number
  dai_dia_mm: number
  buoc_dia_mm: number
  dtam_mm: number
  sigma_cu: number
  sigma_pu: number
  sigma_py: number
  r: number
  k: number
  ep: number
  md_per_tim: number
  total_md: number
  md_per_trip_input: number
  don_gia_van_chuyen: number
  profit_pct?: number
  tax_pct?: number
  qlsx_ly_do_code?: string
  qlsx_ly_do_text?: string
  qlsx_tra_lai_at?: string
  qlsx_duyet_at?: string
}

export type BocTachSegmentInput = {
  template_id?: string
  ma_coc?: string
  ten_doan: string
  len_m: number
  cnt: number
  so_luong_doan: number
  the_tich_m3: number
  v1: number
  v2: number
  v3: number
  mui_segments: number
  dai_kep_chi_a1: boolean
  a1_mm?: number
  a2_mm?: number
  a3_mm?: number
  p1_pct?: number
  p2_pct?: number
  p3_pct?: number
  don_kep_factor?: number
}

export type BocTachItemInput = {
  nvl_id: string
  ten_nvl: string
  loai_nvl:
    | 'CAP_PHOI_BT'
    | 'THEP'
    | 'PHU_GIA'
    | 'PHU_KIEN'
    | 'VAN_CHUYEN'
    | 'KHAC'
  so_luong: number
  dvt: string
  don_gia: number
}

export type BocTachDetailPayload = {
  bocId?: string
  header: BocTachHeaderInput
  segments: BocTachSegmentInput[]
  items: BocTachItemInput[]
}

export type TechPreview = {
  do_mm: number
  t_mm: number
  f_mm: number
  nos: number
  di_mm: number
  dp_mm: number
  d_mm: number
  sigma_cu: number
  sigma_bt: number
  sigma_cp: number
  sigma_t: number
  sigma_pu: number
  sigma_py: number
  ep: number
  es: number
  y: number
  k: number
  ec: number
  ecp: number
  n1: number
  n: number
  ao: number
  ap: number
  ac: number
  ic: number
  is: number
  ie: number
  ze: number
  sigma_pi: number
  sigma_pt: number
  sigma_cpt: number
  d_sig_py: number
  d_sig_r: number
  sigma_pe: number
  sigma_ce: number
  ra_l_kn: number
  ra_s_kn: number
  ra_l: number
  ra_s: number
  mcr_knm: number
  mcr: number
}

export type SegmentNvlSnapshot = {
  ten_doan: string
  len_m: number
  so_luong_doan: number
  v1: number
  v2: number
  v3: number
  tong_vong_dai: number
  concrete_m3: number
  pc_kg: number
  dai_kg: number
  thep_buoc_kg: number
  mat_bich: number
  mang_xong: number
  mui_coc: number
  tap: number
  tong_phu_kien: number
  cap_phoi_items: ConcreteMixMaterialPreview[]
  auxiliary_items: AuxiliaryMaterialPreview[]
}

export type ConcreteMixReference = {
  cp_id?: string
  nvl_id: string
  ten_nvl: string
  mac_be_tong: string
  variant: string
  dinh_muc_m3: number
  dvt: string
}

export type ConcreteMixMaterialPreview = {
  nvl_id: string
  ten_nvl: string
  dvt: string
  dinh_muc_m3: number
  qty: number
}

export type AuxiliaryMaterialReference = {
  dm_id?: string
  nvl_id: string
  ten_nvl: string
  nhom_d: string
  dinh_muc: number
  dvt: string
}

export type AuxiliaryMaterialPreview = {
  nvl_id: string
  ten_nvl: string
  nhom_d: string
  dvt: string
  dinh_muc: number
  qty: number
}

export type PileTemplateReference = {
  template_id: string
  label: string
  ma_coc?: string
  template_scope?: 'FACTORY' | 'CUSTOM'
  loai_coc?: string
  mac_be_tong?: string
  do_ngoai?: number
  chieu_day?: number
  kg_md?: number
  pc_dia_mm?: number
  pc_nos?: number
  dai_dia_mm?: number
  buoc_dia_mm?: number
  dtam_mm?: number
  a1_mm?: number
  a2_mm?: number
  a3_mm?: number
  p1_pct?: number
  p2_pct?: number
  p3_pct?: number
  don_kep_factor?: number
  pc_nvl_id?: string
  dai_nvl_id?: string
  buoc_nvl_id?: string
  pc_label?: string
  dai_label?: string
  buoc_label?: string
  mat_bich_nvl_id?: string
  mang_xong_nvl_id?: string
  tap_nvl_id?: string
  mui_coc_nvl_id?: string
  mat_bich_label?: string
  mang_xong_label?: string
  tap_label?: string
  mui_coc_label?: string
}

export type CustomerReference = {
  kh_id: string
  ma_kh?: string
  ten_kh: string
  thong_tin?: string
}

export type ProjectReference = {
  da_id: string
  ma_da?: string
  ten_da: string
  kh_id: string
  vi_tri_cong_trinh?: string
}

export type MaterialReference = {
  nvl_id: string
  ten_hang: string
  nhom_hang: string
  dvt?: string
  don_gia_hien_hanh?: number
}

export type BocTachReferenceData = {
  concreteMixes: ConcreteMixReference[]
  auxiliaryRates: AuxiliaryMaterialReference[]
  pileTemplates: PileTemplateReference[]
  customers: CustomerReference[]
  projects: ProjectReference[]
  materials: MaterialReference[]
  hasFullReferenceData?: boolean
  vatConfig: {
    coc_vat_pct: number
    phu_kien_vat_pct: number
  }
  profitRules: Array<{
    duong_kinh_mm: number
    min_md: number
    loi_nhuan_pct: number
  }>
  otherCostsByDiameter: Array<{
    duong_kinh_mm: number
    tong_chi_phi_vnd_md: number
  }>
}

export type BocTachPreview = {
  concrete_total_m3: number
  pc_total_kg: number
  dai_total_kg: number
  thep_buoc_kg: number
  total_segments: number
  total_mui_segments: number
  phu_kien: {
    mat_bich: number
    mang_xong: number
    mui_coc: number
    tap: number
  }
  dinh_muc_phu: {
    qty_per_tim: number
    qty_total: number
  }
  van_chuyen: {
    md_per_trip: number
    so_chuyen: number
    phi_van_chuyen: number
    mode: 'AUTO_ROAD' | 'MANUAL_WATERWAY' | 'MANUAL_OTHER_PER_MD' | 'NONE'
    details: Array<{
      label: string
      value: string
    }>
  }
  tong_gia_nvl: number
  tong_gia_pk: number
  tong_du_toan: number
  segment_snapshots: SegmentNvlSnapshot[]
  concrete_mix_materials: ConcreteMixMaterialPreview[]
  auxiliary_materials: AuxiliaryMaterialPreview[]
  tech: TechPreview
}
