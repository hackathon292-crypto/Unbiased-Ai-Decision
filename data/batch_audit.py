
import pandas as pd
import joblib
import json

def run_audit():
    # 1. Load the data and model you already created
    data = pd.read_csv('hiring_test_data.csv')
    model = joblib.load('hiring_model.pkl')
    
    # 2. Get predictions
    X = data[['age', 'education_num', 'hours_per_week']]
    data['decision'] = model.predict(X)
    
    # 3. Calculate Bias (Disparate Impact)
    male_rate = data[data['sex'] == 'Male']['decision'].mean()
    female_rate = data[data['sex'] == 'Female']['decision'].mean()
    ratio = female_rate / male_rate if male_rate > 0 else 1
    
    # 4. Generate the report
    report = {
        "status": "FAIL - Retrain needed" if ratio < 0.8 else "PASS",
        "disparate_impact_ratio": round(ratio, 2),
        "recommendation": "Check for historical bias in age/education" if ratio < 0.8 else "Safe to deploy"
    }
    
    with open('baseline_report.json', 'w') as f:
        json.dump(report, f, indent=4)
    print("Historical Audit Complete! baseline_report.json is ready.")

if __name__ == '__main__':
    run_audit()
