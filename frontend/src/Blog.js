import React, {useState} from "react"

function Blog(props){

    const [edit, setEdit] = useState(false)
    const [editedBlog, setEditedBlog] = useState({ title: props.title, content: props.content })

    function handleDelete(){
        props.onDelete(props.id)
    }

    function handleChange(event){
        const { name, value } = event.target;
        setEditedBlog((prev) => {
            return { ...prev, [name]: value }
        });
    }

    function handleSave(){
        props.onEdit(props.id,editedBlog);
        setEdit(!edit)
    }

    return (<div className="blog-card">
        {(!edit) && (<div>
            <h2>{props.title}</h2>
            <p>{props.content}</p>
            <button onClick={()=>{setEdit(!edit)}}>Edit</button> 
            <button onClick={handleDelete}>Delete</button>
            </div>
        )}
        
        {edit && (<div>
            <input name="title" id={props.id} value={editedBlog.title || ""} onChange={handleChange}></input>
            <textarea name="content" id={props.id} value={editedBlog.content || ""} onChange={handleChange}></textarea>
            <button onClick={handleSave}>Save</button>
            <button onClick={()=>{setEdit(!edit);setEditedBlog({ title: props.title, content: props.content})}}>Cancel</button>
            </div>
        )}
    </div>)
}

export default Blog
