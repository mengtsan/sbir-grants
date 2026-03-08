import { CheckCircle2, XCircle } from 'lucide-react';

interface QualityRadarChartProps {
    results: Record<string, boolean>;
    reasons: Record<string, string>;
    scorePct: number;
}

const DIMENSION_LABELS: Record<string, string> = {
    "ch_7": "創新差異化",
    "ch_8": "市場三層分析",
    "ch_9": "商業模式",
    "ch_10": "執行期程",
    "ch_11": "數據可信度",
    "ch_12": "語氣專業度"
};

const CHART_SIZE = 280;
const CENTER = CHART_SIZE / 2;
const MAX_RADIUS = 92;
const LABEL_RADIUS = 122;
const GRID_LEVELS = 5;

const polarToCartesian = (angle: number, radius: number) => ({
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
});

const buildPolygonPath = (values: number[], radius: number) => {
    const step = (Math.PI * 2) / values.length;
    return values.map((value, index) => {
        const angle = -Math.PI / 2 + (step * index);
        const point = polarToCartesian(angle, (value / 100) * radius);
        return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }).join(' ') + ' Z';
}

export default function QualityRadarChart({ results, reasons, scorePct }: QualityRadarChartProps) {
    if (!results || Object.keys(results).length === 0) {
        return <div className="p-4 text-center text-gray-500">尚無審查資料</div>;
    }

    const dimensions = Object.keys(DIMENSION_LABELS).map((key) => ({
        key,
        subject: DIMENSION_LABELS[key],
        score: results[key] ? 100 : 20,
    }));
    const polygonPath = buildPolygonPath(dimensions.map((item) => item.score), MAX_RADIUS);
    const gridPaths = Array.from({ length: GRID_LEVELS }, (_, level) => {
        const value = ((level + 1) / GRID_LEVELS) * 100;
        return buildPolygonPath(new Array(dimensions.length).fill(value), MAX_RADIUS);
    });
    const axisLines = dimensions.map((_, index) => {
        const angle = -Math.PI / 2 + ((Math.PI * 2) / dimensions.length) * index;
        return polarToCartesian(angle, MAX_RADIUS);
    });
    const labelPoints = dimensions.map((item, index) => {
        const angle = -Math.PI / 2 + ((Math.PI * 2) / dimensions.length) * index;
        return { ...item, ...polarToCartesian(angle, LABEL_RADIUS) };
    });

    const failedDimensions = Object.keys(results).filter(key => !results[key]);
    const passedDimensions = Object.keys(results).filter(key => results[key]);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col md:flex-row">
            {/* Left side: Chart */}
            <div className="md:w-1/2 p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-100 bg-slate-50/50">
                <h3 className="text-lg font-bold text-slate-800 mb-2">計畫書 6 維度品質診斷</h3>
                <div className="text-sm text-slate-500 mb-4">綜合防禦力：{scorePct}%</div>

                <div className="w-full max-w-[320px]">
                    <svg
                        viewBox={`0 0 ${CHART_SIZE} ${CHART_SIZE}`}
                        className="w-full h-auto"
                        role="img"
                        aria-label="SBIR 計畫書品質六維雷達圖"
                    >
                        {gridPaths.map((path, index) => (
                            <path
                                key={`grid-${index}`}
                                d={path}
                                fill="none"
                                stroke="#dbeafe"
                                strokeWidth={index === gridPaths.length - 1 ? 1.5 : 1}
                            />
                        ))}

                        {axisLines.map((point, index) => (
                            <line
                                key={`axis-${index}`}
                                x1={CENTER}
                                y1={CENTER}
                                x2={point.x}
                                y2={point.y}
                                stroke="#cbd5e1"
                                strokeWidth="1"
                            />
                        ))}

                        <path
                            d={polygonPath}
                            fill="rgba(59, 130, 246, 0.28)"
                            stroke="#2563eb"
                            strokeWidth="2.5"
                        />

                        {labelPoints.map((point) => (
                            <text
                                key={point.key}
                                x={point.x}
                                y={point.y}
                                textAnchor={point.x < CENTER - 8 ? 'end' : point.x > CENTER + 8 ? 'start' : 'middle'}
                                dominantBaseline={point.y < CENTER - 8 ? 'alphabetic' : point.y > CENTER + 8 ? 'hanging' : 'middle'}
                                className="fill-slate-600 text-[11px] font-medium"
                            >
                                {point.subject}
                            </text>
                        ))}
                    </svg>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-500">
                        {dimensions.map((item) => (
                            <div key={item.key} className="flex items-center gap-2">
                                <span className={`inline-block h-2.5 w-2.5 rounded-full ${results[item.key] ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                <span>{item.subject}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right side: Actionable Feedback */}
            <div className="md:w-1/2 p-6 overflow-y-auto max-h-[400px]">
                {failedDimensions.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center space-y-3 text-center">
                        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                            <CheckCircle2 size={32} />
                        </div>
                        <h4 className="text-xl font-bold text-green-700">完美無瑕！</h4>
                        <p className="text-slate-600">您的計畫書已達到六邊形戰士標準，這是一份能讓審查委員驚豔的傑作！</p>
                    </div>
                ) : (
                    <div>
                        <h4 className="text-md flex items-center gap-2 font-bold text-red-600 mb-4 pb-2 border-b border-red-100">
                            <XCircle className="w-5 h-5" />
                            發現 {failedDimensions.length} 處致命缺陷 (需立即改善)
                        </h4>
                        <div className="space-y-4">
                            {failedDimensions.map(key => (
                                <div key={key} className="bg-red-50/50 p-4 rounded-lg border border-red-100">
                                    <div className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-red-500"></div>
                                        {DIMENSION_LABELS[key]}
                                    </div>
                                    <div className="text-sm text-slate-600">{reasons[key]}</div>
                                </div>
                            ))}
                        </div>

                        {passedDimensions.length > 0 && (
                            <div className="mt-8">
                                <h4 className="text-sm font-bold text-slate-500 mb-3 uppercase tracking-wider">已達成之指標</h4>
                                <div className="space-y-2">
                                    {passedDimensions.map(key => (
                                        <div key={key} className="flex gap-2 items-start text-sm">
                                            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                            <div>
                                                <span className="font-medium text-slate-700">{DIMENSION_LABELS[key]}</span>
                                                <span className="text-slate-500 ml-2">{reasons[key]}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
