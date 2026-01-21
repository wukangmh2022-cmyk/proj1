import { serializeDrawingAlert } from './drawing_alert_utils';

export const normalizeAlertsForNative = (alerts) => {
  return alerts.map(a => {
    const normalizedCondition = Array.isArray(a.condition)
      ? a.condition[0]
      : (Array.isArray(a.conditions) ? a.conditions[0] : a.condition);
    const normalizedConditions = Array.isArray(a.conditions)
      ? a.conditions
      : (Array.isArray(a.condition) ? a.condition : (a.condition ? [a.condition] : null));
    const normalizedTargetValue = Array.isArray(a.targetValue) ? a.targetValue[0] : a.targetValue;
    const normalizedTargetValues = Array.isArray(a.targetValues)
      ? a.targetValues
      : (Array.isArray(a.targetValue) ? a.targetValue : null);
    const baseAlert = {
      ...a,
      condition: normalizedCondition,
      conditions: normalizedConditions,
      targetValue: normalizedTargetValue,
      targetValues: normalizedTargetValues
    };

    if (baseAlert.targetType === 'drawing' && baseAlert.target === 0) {
      try {
        const drawingsStr = localStorage.getItem(`chart_drawings_${baseAlert.symbol}`);
        if (drawingsStr) {
          const drawings = JSON.parse(drawingsStr);
          const d = drawings.find(x => x.id === baseAlert.targetValue);
          if (d) {
            const serialized = serializeDrawingAlert(d);
            if (serialized) {
              return {
                ...baseAlert,
                algo: serialized.algo,
                params: serialized.params
              };
            }
          }
        }
      } catch (e) {
        console.error('Enrich Drawing Alert Error', e);
      }
    }
    return baseAlert;
  });
};
