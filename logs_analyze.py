import pandas as pd
import json

file_path = "logs_rows_offline-6participants.csv"
df = pd.read_csv(file_path)

df['details_parsed'] = df['details'].apply(lambda x: json.loads(x) if pd.notnull(x) else {})

df['questionId'] = df['details_parsed'].apply(lambda x: x.get('questionId'))
df['isCorrect'] = df['details_parsed'].apply(lambda x: x.get('isCorrect'))

df['question_asked'] = df.apply(lambda row: row['details_parsed'].get('userQuestion') if row['action'] == 'ai_generate_request' else None, axis=1)

df['timestamp'] = pd.to_datetime(df['timestamp'])

def get_email(user_df):
    login_success = user_df[user_df['action'] == 'login_success']
    if not login_success.empty:
        return login_success['details_parsed'].iloc[-1].get('email')
    else:
        return None

def calculate_answer_times(user_df):
    user_df = user_df.sort_values(by='timestamp').reset_index(drop=True)
    
    time_diffs = {1: [], 2: []}
    
    for i in range(1, len(user_df)):
        if user_df['action'].iloc[i] == 'blank_answer_submit' and pd.notnull(user_df['questionId'].iloc[i]):
            time_diff = (user_df['timestamp'].iloc[i] - user_df['timestamp'].iloc[i-1]).total_seconds()
            qid = int(user_df['questionId'].iloc[i])
            time_diffs[qid].append(time_diff)
    
    return time_diffs

user_analysis = []

for user_id, user_df in df.groupby('user_id'):
    if pd.isna(user_id):  
        continue
        
    user_email = get_email(user_df)
    
    correct = user_df[(user_df['action'] == 'blank_answer_submit') & (user_df['isCorrect'] == True)].shape[0]
    incorrect = user_df[(user_df['action'] == 'blank_answer_submit') & (user_df['isCorrect'] == False)].shape[0]
    total_questions_asked_to_user = correct + incorrect
    
    i_do_not_understand = user_df[user_df['action'] == 'dont_understand_button_click'].shape[0]
    
    questions_asked = user_df.loc[user_df['action'] == 'ai_generate_request', 'question_asked'].dropna().tolist()
    
    time_per_question = {}
    for qid in [1, 2]:
        question_df = user_df[user_df['questionId'] == qid].sort_values(by='timestamp')
        if not question_df.empty:
            time_spent = (question_df['timestamp'].iloc[-1] - question_df['timestamp'].iloc[0]).total_seconds()
            time_per_question[qid] = time_spent / 60 
        else:
            time_per_question[qid] = 0
    
    answer_times = calculate_answer_times(user_df)
    
    user_dict = {
        'user_id': user_id,
        'email': user_email,
        'total_questions_asked_to_user': total_questions_asked_to_user,
        'correct_answers': correct,
        'incorrect_answers': incorrect,
        'i_do_not_understand': i_do_not_understand,
        'user_questions_asked': questions_asked,
        'time_spent_question_1(mins)': time_per_question[1],
        'time_spent_question_2(mins)': time_per_question[2]
    }
    
    for qid in [1, 2]:
        for i, time_diff in enumerate(answer_times[qid]):
            col_name = f'Q{qid}{chr(97 + i)}(secs)'
            user_dict[col_name] = time_diff
    
    user_analysis.append(user_dict)

output_df = pd.DataFrame(user_analysis)

output_df.to_csv("logs_rows_offline-6participants_analysis.csv", index=False)