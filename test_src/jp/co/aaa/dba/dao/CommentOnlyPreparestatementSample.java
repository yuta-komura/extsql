public class CommentOnlyPreparestatementSample {
    public void test() {
        StringBuilder sb = new StringBuilder();
        sb.append(" SELECT ");
        sb.append(" * ");
        // preparestatement only in comment
        sb.append(" FROM DUAL ");
    }
}
