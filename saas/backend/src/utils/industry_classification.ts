export interface OfficialIndustryCategory {
    code: string
    name: string
    aliases: string[]
    benchmark_bucket: '製造業' | '資通訊' | '生技/醫療' | '服務業'
}

export const OFFICIAL_INDUSTRY_MAJOR_CATEGORIES: OfficialIndustryCategory[] = [
    { code: 'A', name: '農、林、漁、牧業', aliases: ['農業', '農', '林業', '漁業', '牧業', '養殖'], benchmark_bucket: '服務業' },
    { code: 'B', name: '礦業及土石採取業', aliases: ['礦業', '土石', '採石'], benchmark_bucket: '製造業' },
    { code: 'C', name: '製造業', aliases: ['製造', '工廠', '加工', '代工'], benchmark_bucket: '製造業' },
    { code: 'D', name: '電力及燃氣供應業', aliases: ['電力', '燃氣', '能源'], benchmark_bucket: '製造業' },
    { code: 'E', name: '用水供應及污染整治業', aliases: ['用水', '污水', '污染整治', '廢棄物'], benchmark_bucket: '製造業' },
    { code: 'F', name: '營建工程業', aliases: ['營建', '建築', '土木', '工程承包', '裝修'], benchmark_bucket: '製造業' },
    { code: 'G', name: '批發及零售業', aliases: ['批發', '零售', '電商', '通路', '賣場', '銷售'], benchmark_bucket: '服務業' },
    { code: 'H', name: '運輸及倉儲業', aliases: ['運輸', '物流', '倉儲', '配送'], benchmark_bucket: '服務業' },
    { code: 'I', name: '住宿及餐飲業', aliases: ['住宿', '旅館', '飯店', '餐飲', '餐廳', '咖啡'], benchmark_bucket: '服務業' },
    { code: 'J', name: '出版影音及資通訊業', aliases: ['資通訊', '資訊', '軟體', 'saas', 'app', '平台', 'ai', '系統開發', '數位', '影音', '出版'], benchmark_bucket: '資通訊' },
    { code: 'K', name: '金融及保險業', aliases: ['金融', '保險', '銀行', '證券', '投資'], benchmark_bucket: '服務業' },
    { code: 'L', name: '不動產業', aliases: ['不動產', '房地產', '房仲', '租賃'], benchmark_bucket: '服務業' },
    { code: 'M', name: '專業、科學及技術服務業', aliases: ['顧問', '行銷顧問', '管理顧問', '廣告', '公關', '設計', '市場研究', '科學服務', '技術服務', '研發服務', '檢測'], benchmark_bucket: '服務業' },
    { code: 'N', name: '支援服務業', aliases: ['人力派遣', '租賃支援', '清潔', '保全', '客服'], benchmark_bucket: '服務業' },
    { code: 'O', name: '公共行政及國防；強制性社會安全', aliases: ['公共行政', '國防', '政府機關'], benchmark_bucket: '服務業' },
    { code: 'P', name: '教育業', aliases: ['教育', '補教', '培訓', '課程'], benchmark_bucket: '服務業' },
    { code: 'Q', name: '醫療保健及社會工作服務業', aliases: ['醫療', '生技', '醫材', '診所', '照護', '健康', '保健', '社工'], benchmark_bucket: '生技/醫療' },
    { code: 'R', name: '藝術、娛樂及休閒服務業', aliases: ['藝術', '娛樂', '休閒', '展演', '遊戲', '文創'], benchmark_bucket: '服務業' },
    { code: 'S', name: '其他服務業', aliases: ['其他服務', '美容', '維修', '個人服務'], benchmark_bucket: '服務業' },
]

export const OFFICIAL_INDUSTRY_OPTIONS = OFFICIAL_INDUSTRY_MAJOR_CATEGORIES.map(
    (category) => `${category.code} ${category.name}`
)

export const normalizeOfficialIndustry = (rawInput: string): string | null => {
    const trimmed = rawInput.trim()
    if (!trimmed) return null

    const direct = OFFICIAL_INDUSTRY_OPTIONS.find((option) => option === trimmed)
    if (direct) return direct

    const normalized = trimmed.toLowerCase()
    const byCode = OFFICIAL_INDUSTRY_MAJOR_CATEGORIES.find((category) => normalized === category.code.toLowerCase())
    if (byCode) return `${byCode.code} ${byCode.name}`

    const byName = OFFICIAL_INDUSTRY_MAJOR_CATEGORIES.find((category) =>
        normalized.includes(category.name.toLowerCase()) ||
        category.aliases.some((alias) => normalized.includes(alias.toLowerCase()))
    )
    if (byName) return `${byName.code} ${byName.name}`

    return null
}

export const mapIndustryToBenchmarkBucket = (industry: string): string => {
    const normalized = normalizeOfficialIndustry(industry)
    if (normalized) {
        const category = OFFICIAL_INDUSTRY_MAJOR_CATEGORIES.find((item) => `${item.code} ${item.name}` === normalized)
        if (category) return category.benchmark_bucket
    }

    if (industry.includes('資通訊') || industry.includes('軟體') || industry.includes('數位')) return '資通訊'
    if (industry.includes('醫療') || industry.includes('生技')) return '生技/醫療'
    if (industry.includes('製造') || industry.includes('機械') || industry.includes('電子') || industry.includes('材料')) return '製造業'
    return '服務業'
}

export const isOfficialIndustryOption = (value: string): boolean => {
    return OFFICIAL_INDUSTRY_OPTIONS.includes(value.trim())
}

export const splitOfficialIndustry = (value: string): { code: string; name: string } | null => {
    const normalized = normalizeOfficialIndustry(value)
    if (!normalized) return null
    const match = normalized.match(/^([A-S])\s+(.+)$/)
    if (!match) return null
    return { code: match[1], name: match[2] }
}
